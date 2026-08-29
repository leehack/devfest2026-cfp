import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import type { Locale } from '../i18n';
import { invalidateCache, swrFetch } from './cache';
import { mapEmpty, toDocuments, type FormState } from './formState';
import type { EditScope } from './lifecycle';
import { cfpState } from '@shared/cfpWindow';
import type { ProposalStatus } from '@shared/enums';
import type { SessionizeProfile } from '@shared/sessionize';
import {
  EMPTY_FORM,
  type Answers,
  type ConfirmForm,
  confirmFormFromData,
  type ConfirmedSpeakerPhoto,
  type HeadshotUploads,
  type SpeakerProfilePhoto,
} from '@shared/confirmForm';
import {
  attendanceWriteFor,
  mergeSubmissionForm,
  type SubmissionForm,
} from '@shared/submissionForm';
import type { CfpProfile, Visibility } from '@shared/cfp';
import type {
  Cfp,
  SpeakerProfilePreviewField,
  SpeakerProfilePreviewFields,
  SpeakerProfileUpdateRequestState,
  SpeakerProfileUpdateScope,
  SpeakerSnapshot,
} from '@shared/types';

export interface CfpWindow {
  name: string;
  opensAt: Date;
  closesAt: Date;
  paused: boolean;
  /** Archived reads as closed, and is checked first — see `assertCfpOpen`. */
  state: 'before' | 'open' | 'paused' | 'closed' | 'archived';
  /**
   * What the front page says about the event. Carried here rather than fetched
   * again because this already reads the whole document — the window and the
   * description live in the same one.
   */
  profile: CfpProfile;
  visibility: Visibility;
  sharedScheduleId?: string;
  publishedScheduleId?: string;
  theme?: Cfp['theme'];
  features?: Cfp['features'];
  orgId?: string;
}

/**
 * The window, read off the CFP document itself. Null means there is no such CFP
 * — a mistyped link, or one that has been deleted.
 */
export async function loadCfpWindow(
  cfpId: string,
  options: {
    force?: boolean;
    backgroundRevalidate?: boolean;
    onRevalidate?: (data: CfpWindow | null) => void;
  } = {},
): Promise<CfpWindow | null> {
  return swrFetch(
    `cfpWindow:${cfpId}`,
    async () => {
      const snap = await getDoc(doc(db, 'cfps', cfpId));
      if (!snap.exists()) return null;

      const data = snap.data() as Cfp & { opensAt: Timestamp; closesAt: Timestamp };
      const opensAt = data.opensAt.toDate();
      const closesAt = data.closesAt.toDate();
      const now = Date.now();

      // Advisory only. The rules and submitProposal re-check against the server
      // clock — this just decides what the page renders.
      const state = cfpState(
        {
          archived: data.archived,
          paused: data.paused,
          opensAtMs: opensAt.getTime(),
          closesAtMs: closesAt.getTime(),
        },
        now,
      );

      return {
        name: data.name ?? cfpId,
        opensAt,
        closesAt,
        paused: data.paused,
        state,
        visibility: data.visibility ?? 'public',
        profile: {
          description: data.description,
          eventDate: data.eventDate,
          eventStartDate: data.eventStartDate ?? data.eventDate,
          eventEndDate: data.eventEndDate ?? data.eventStartDate ?? data.eventDate,
          timeZone: data.timeZone,
          venue: data.venue,
          location: data.location,
          website: data.website,
        },
        sharedScheduleId: data.sharedScheduleId,
        publishedScheduleId: data.publishedScheduleId,
        theme: data.theme,
        features: data.features,
        orgId: data.orgId,
      };
    },
    {
      force: options.force,
      backgroundRevalidate: options.backgroundRevalidate ?? true,
      onRevalidate: options.onRevalidate,
    },
  );
}

export interface LoadedProposal {
  id: string;
  status: ProposalStatus;
  proposal: Record<string, any>;
  speaker: Record<string, any> | undefined;
  ownConfirmation?: {
    response?: 'confirmed' | 'declined';
    answers: Answers;
    headshotUploads?: HeadshotUploads;
    speakerPhoto?: ConfirmedSpeakerPhoto;
  };
  ownParticipation?: {
    role?: 'primary' | 'coSpeaker';
    acks?: Record<string, boolean>;
    attendance?: Record<string, any>;
    detailsComplete?: boolean;
  };
}

/**
 * Every talk this speaker has, plus the one speaker profile they all share.
 *
 * §2: no `onSnapshot` on anything list-shaped — ten reviewers on a live list
 * view is how the 50k/day read quota disappears. One-shot, and the query stays
 * scoped by `array-contains` because the rules deny an unscoped listing.
 */
export async function loadMyProposals(
  cfpId: string,
  user: User,
  options: { force?: boolean } = {},
): Promise<{ talks: LoadedProposal[]; speaker: Record<string, any> | undefined }> {
  return swrFetch(
    `myProposals:${cfpId}:${user.uid}`,
    async () => {
      const [snap, speakerSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'cfps', cfpId, 'proposals'),
            where('speakerIds', 'array-contains', user.uid),
          ),
        ),
        getDoc(doc(db, 'speakers', user.uid)),
      ]);

      const speaker = speakerSnap.exists() ? speakerSnap.data() : undefined;
      const [confirmationSnaps, participationSnaps] = await Promise.all([
        Promise.all(
          snap.docs.map((proposal) =>
            getDoc(
              doc(
                db,
                'cfps',
                cfpId,
                'proposals',
                proposal.id,
                'speakerConfirmations',
                user.uid,
              ),
            ),
          ),
        ),
        Promise.all(
          snap.docs.map((proposal) =>
            getDoc(
              doc(
                db,
                'cfps',
                cfpId,
                'proposals',
                proposal.id,
                'speakerParticipants',
                user.uid,
              ),
            ),
          ),
        ),
      ]);

      return {
        talks: snap.docs.map((d, index) => {
          const proposal = d.data();
          const confirmation = confirmationSnaps[index];
          const participation = participationSnaps[index];
          const ids = Array.isArray(proposal.speakerIds) ? proposal.speakerIds : [];
          const usesPersonalConfirmation = Boolean(proposal.primarySpeakerId) || ids.length > 1;
          const legacyResponse =
            proposal.status === 'confirmed' || proposal.status === 'declined'
              ? proposal.status
              : undefined;
          const ownConfirmation = confirmation.exists()
            ? {
                response: confirmation.data().response as 'confirmed' | 'declined' | undefined,
                answers: (confirmation.data().answers ?? {}) as Answers,
                headshotUploads: confirmation.data().headshotUploads as HeadshotUploads | undefined,
                speakerPhoto: confirmation.data().speakerPhoto as ConfirmedSpeakerPhoto | undefined,
              }
            : usesPersonalConfirmation
              ? undefined
              : {
                  response: legacyResponse,
                  answers: (proposal.confirmAnswers ?? {}) as Answers,
                  headshotUploads: proposal.headshotUploads as HeadshotUploads | undefined,
                  speakerPhoto: proposal.speakerPhoto as ConfirmedSpeakerPhoto | undefined,
                };
          return {
            id: d.id,
            status: (proposal.status ?? 'draft') as ProposalStatus,
            proposal,
            speaker,
            ownConfirmation,
            ownParticipation: participation.exists()
              ? {
                  role: participation.data().role,
                  acks: participation.data().acks,
                  attendance: participation.data().attendance,
                  detailsComplete: participation.data().detailsComplete,
                }
              : undefined,
          };
        }),
        speaker,
      };
    },
    { force: options.force, backgroundRevalidate: true },
  );
}

/**
 * Writes both documents. `status` is set to `draft` only on the very first
 * write and never sent again — the rules reject any update that touches it.
 */
export async function saveDraft(
  cfpId: string,
  user: User,
  form: FormState,
  shape: SubmissionForm,
  proposalId: string | null,
  scope: EditScope = 'all',
  locale: Locale = 'en',
  usesPersonalLifecycle = false,
  personalScope: EditScope = scope,
): Promise<string> {
  const { proposalDoc, speakerDoc } = toDocuments(form);
  const attendance = attendanceWriteFor(shape, proposalDoc.attendance);
  const shapedProposalDoc: Record<string, any> = {
    ...proposalDoc,
    ...(attendance ? { attendance } : {}),
  };
  if (!attendance) delete shapedProposalDoc.attendance;
  const existing = proposalId !== null;

  // On create an empty optional is simply absent; on update it needs an explicit
  // deleteField(), since `{merge: true}` ignores keys that are not present.
  const forWrite = (o: Record<string, any>) =>
    existing ? mapEmpty(o, deleteField()) : mapEmpty(o, undefined);

  await setDoc(
    doc(db, 'speakers', user.uid),
    {
      ...forWrite(speakerDoc),
      // Email comes from the identity provider, never the form — the rules
      // require it to match the current auth token on every write.
      email: user.email ?? '',
      // Which language to write to them in. Whatever they filled the form in is
      // the best evidence we have, and it beats guessing from the address.
      locale,
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );

  if (proposalId) {
    const { acks, attendance: personalAttendance, ...talkDoc } = shapedProposalDoc;
    if (usesPersonalLifecycle && personalScope !== 'none') {
      const personalPatch =
        personalScope === 'logistics'
          ? personalAttendance
            ? { attendance: personalAttendance }
            : {}
          : { acks, ...(personalAttendance ? { attendance: personalAttendance } : {}) };
      await setDoc(
        doc(
          db,
          'cfps',
          cfpId,
          'proposals',
          proposalId,
          'speakerParticipants',
          user.uid,
        ),
        {
          ...forWrite(personalPatch),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    // Under review the rules accept `attendance` and nothing else, so send
    // nothing else — a full write would be rejected in its entirety, taking
    // the speaker's profile edit down with it.
    const patch =
      scope === 'logistics'
        ? usesPersonalLifecycle
          ? {}
          : personalAttendance
            ? forWrite({ attendance: personalAttendance })
            : {}
        : forWrite(usesPersonalLifecycle ? talkDoc : shapedProposalDoc);

    if (scope !== 'none' && Object.keys(patch).length > 0) {
      await setDoc(
        doc(db, 'cfps', cfpId, 'proposals', proposalId),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    return proposalId;
  }

  const created = await addDoc(collection(db, 'cfps', cfpId, 'proposals'), {
    ...forWrite(shapedProposalDoc),
    // Denormalised from the path so a collection-group query can be filtered by
    // tenant, and pinned to it by the rules so the field cannot lie.
    cfpId,
    speakerIds: [user.uid],
    // The only status a client ever writes, and only here (§6).
    status: 'draft',
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

/**
 * The speaker's own profile, on its own — no CFP involved.
 *
 * `speakers/{uid}` is global, so the profile page reads and writes it directly
 * rather than through a call for proposals. Same document the submission form
 * saves; the only difference is that nothing else is being written with it.
 */
export async function loadProfile(
  user: User,
  options: { force?: boolean } = {},
): Promise<Record<string, any> | undefined> {
  return swrFetch(
    `speakerProfile:${user.uid}`,
    async () => {
      const snap = await getDoc(doc(db, 'speakers', user.uid));
      return snap.exists() ? snap.data() : undefined;
    },
    { force: options.force, backgroundRevalidate: true },
  );
}

export async function saveProfile(user: User, form: FormState, locale: Locale): Promise<void> {
  const { speakerDoc } = toDocuments(form);
  const existing = (await getDoc(doc(db, 'speakers', user.uid))).exists();

  await setDoc(
    doc(db, 'speakers', user.uid),
    {
      // As in `saveDraft`: an empty optional is absent on create and an explicit
      // deletion on update, because `{merge: true}` ignores keys that are not there.
      ...(existing ? mapEmpty(speakerDoc, deleteField()) : mapEmpty(speakerDoc, undefined)),
      // Never from the form — the rules require it to match the auth token.
      email: user.email ?? '',
      locale,
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  invalidateCache(`speakerProfile:${user.uid}`);
  invalidateCache('myProposals');
}

export const uploadProfilePhoto = httpsCallable<
  { contentType: string; base64: string },
  { ok: true; generation: string }
>(functions, 'uploadProfilePhoto');

export const profilePhotoImage = httpsCallable<
  Record<string, never>,
  { ok: true; generation: string; contentType: string; base64: string }
>(functions, 'profilePhotoImage');

export const removeProfilePhoto = httpsCallable<
  Record<string, never>,
  { ok: true }
>(functions, 'removeProfilePhoto');

export type ProposalSpeakerProfileField = SpeakerProfilePreviewField;
export type ProposalSpeakerProfileScope = SpeakerProfileUpdateScope;
export type ProposalSpeakerProfileValue = SpeakerProfilePreviewFields;
export type ProposalSpeakerProfileUpdateRequest = SpeakerProfileUpdateRequestState;

export const refreshProposalSpeakerSnapshot = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    speakerUid?: string;
    expectedCurrentFingerprint: string;
    expectedLatestFingerprint: string;
  },
  {
    ok: true;
    changed: boolean;
    speakerUid: string;
    snapshot: SpeakerSnapshot;
    currentFingerprint: string;
    latestFingerprint: string;
    scheduleNeedsAttention: boolean;
  }
>(functions, 'refreshProposalSpeakerSnapshot');

export interface ProposalSpeakerProfilePreview {
  ok: true;
  speakerUid: string;
  currentFingerprint: string;
  latestFingerprint: string;
  current: ProposalSpeakerProfileValue;
  latest: ProposalSpeakerProfileValue;
  changes: Array<{
    field: ProposalSpeakerProfileField;
    before: unknown | null;
    after: unknown | null;
  }>;
  photo: {
    enabled: boolean;
    current: 'present' | 'absent';
    latest: 'present' | 'absent';
    changed: boolean;
  };
  request: ProposalSpeakerProfileUpdateRequest | null;
}

export const previewProposalSpeakerProfile = httpsCallable<
  { cfpId: string; proposalId: string; speakerUid?: string },
  ProposalSpeakerProfilePreview
>(functions, 'previewProposalSpeakerProfile');

export const requestProposalSpeakerProfileUpdate = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    speakerUid: string;
    scopes: ProposalSpeakerProfileScope[];
  },
  {
    ok: true;
    created: boolean;
    request: ProposalSpeakerProfileUpdateRequest;
  }
>(functions, 'requestProposalSpeakerProfileUpdate');

export const cancelProposalSpeakerProfileUpdate = httpsCallable<
  { cfpId: string; proposalId: string; speakerUid: string; requestId: string },
  { ok: true; changed: boolean; request: ProposalSpeakerProfileUpdateRequest }
>(functions, 'cancelProposalSpeakerProfileUpdate');

export const completeProposalSpeakerProfileUpdate = httpsCallable<
  { cfpId: string; proposalId: string; requestId: string },
  {
    ok: true;
    changed: boolean;
    request: ProposalSpeakerProfileUpdateRequest;
    remainingScopes: ProposalSpeakerProfileScope[];
  }
>(functions, 'completeProposalSpeakerProfileUpdate');

export type { SpeakerProfilePhoto };

interface CallableResult {
  ok: boolean;
  proposalId?: string;
  alreadySubmitted?: boolean;
}

export const submitProposal = httpsCallable<{ cfpId: string; proposalId: string }, CallableResult>(
  functions,
  'submitProposal',
);

export const withdrawProposal = httpsCallable<{ cfpId: string; proposalId: string }, CallableResult>(
  functions,
  'withdrawProposal',
);

export const deleteDraftProposal = httpsCallable<
  { cfpId: string; proposalId: string },
  CallableResult
>(functions, 'deleteDraftProposal');

export const uploadHeadshot = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    key: string;
    contentType: string;
    /** Canonical padded base64, without a data-URL prefix. */
    base64: string;
  },
  { ok: boolean; path: string }
>(functions, 'uploadHeadshot');

export const workingHeadshotImage = httpsCallable<
  { cfpId: string; proposalId: string; key: string; working: true },
  { ok: boolean; contentType: string; base64: string }
>(functions, 'headshotImage');

export const respondToDecision = httpsCallable<
  { cfpId: string; proposalId: string; response: 'confirm' | 'decline'; answers?: Answers },
  CallableResult & {
    status: ProposalStatus;
    response: 'confirmed' | 'declined';
  }
>(functions, 'respondToDecision');

/**
 * The organiser's questions. Readable by anyone signed in, so this is a plain
 * document read rather than a callable — the speaker's page needs it before it
 * can render the confirmation.
 */
export async function loadConfirmForm(
  cfpId: string,
  options: { force?: boolean } = {},
): Promise<ConfirmForm> {
  return swrFetch(
    `confirmForm:${cfpId}`,
    async () => {
      const snap = await getDoc(doc(db, 'cfps', cfpId, 'config', 'confirmForm'));
      return snap.exists() ? confirmFormFromData(snap.data()) : EMPTY_FORM;
    },
    { force: options.force, backgroundRevalidate: true },
  );
}

/**
 * The form this call actually asks — its categories, formats, levels, the
 * languages it offers, its consents and any questions of its own.
 *
 * A missing document is not an error: every call that existed before the form
 * became configurable has none, and the defaults are what they were already
 * using. Merged key by key so a config that sets only `fields` still gets the
 * standard taxonomy rather than four empty dropdowns.
 */
export async function loadSubmissionForm(
  cfpId: string,
  options: { force?: boolean } = {},
): Promise<SubmissionForm> {
  return swrFetch(
    `submissionForm:${cfpId}`,
    async () => {
      const snap = await getDoc(doc(db, 'cfps', cfpId, 'config', 'submissionForm'));
      return mergeSubmissionForm(snap.exists() ? snap.data() : undefined);
    },
    { force: options.force, backgroundRevalidate: true },
  );
}

export const importSessionizeProfile = httpsCallable<
  { url: string },
  {
    ok: boolean;
    profile: SessionizeProfile;
    /** Set when a talk link was pasted and that talk is still on the profile. */
    preselectSessionId?: string;
    /** True when a talk link was pasted but no longer appears on the profile. */
    requestedSessionMissing?: boolean;
  }
>(functions, 'importSessionizeProfile');
