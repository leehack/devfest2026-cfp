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
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import type { Locale } from '../i18n';
import { mapEmpty, toDocuments, type FormState } from './formState';
import type { EditScope } from './lifecycle';
import { cfpState } from '@shared/cfpWindow';
import type { ProposalStatus } from '@shared/enums';
import type { SessionizeProfile } from '@shared/sessionize';
import { EMPTY_FORM, type Answers, type ConfirmForm } from '@shared/confirmForm';
import { mergeSubmissionForm, type SubmissionForm } from '@shared/submissionForm';
import type { CfpProfile, Visibility } from '@shared/cfp';
import type { Cfp } from '@shared/types';

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
}

/**
 * The window, read off the CFP document itself. Null means there is no such CFP
 * — a mistyped link, or one that has been deleted.
 */
export async function loadCfpWindow(cfpId: string): Promise<CfpWindow | null> {
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
      venue: data.venue,
      location: data.location,
      website: data.website,
    },
  };
}

export interface LoadedProposal {
  id: string;
  status: ProposalStatus;
  proposal: Record<string, any>;
  speaker: Record<string, any> | undefined;
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
): Promise<{ talks: LoadedProposal[]; speaker: Record<string, any> | undefined }> {
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

  return {
    talks: snap.docs.map((d) => ({
      id: d.id,
      status: (d.data().status ?? 'draft') as ProposalStatus,
      proposal: d.data(),
      speaker,
    })),
    speaker,
  };
}

/**
 * Writes both documents. `status` is set to `draft` only on the very first
 * write and never sent again — the rules reject any update that touches it.
 */
export async function saveDraft(
  cfpId: string,
  user: User,
  form: FormState,
  proposalId: string | null,
  scope: EditScope = 'all',
  locale: Locale = 'en',
): Promise<string> {
  const { proposalDoc, speakerDoc } = toDocuments(form);
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
      // require it to match the auth token on create and stay put on update.
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
    // Under review the rules accept `attendance` and nothing else, so send
    // nothing else — a full write would be rejected in its entirety, taking
    // the speaker's profile edit down with it.
    const patch =
      scope === 'logistics'
        ? { attendance: proposalDoc.attendance }
        : forWrite(proposalDoc);

    if (scope !== 'none') {
      await setDoc(
        doc(db, 'cfps', cfpId, 'proposals', proposalId),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    return proposalId;
  }

  const created = await addDoc(collection(db, 'cfps', cfpId, 'proposals'), {
    ...forWrite(proposalDoc),
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
export async function loadProfile(user: User): Promise<Record<string, any> | undefined> {
  const snap = await getDoc(doc(db, 'speakers', user.uid));
  return snap.exists() ? snap.data() : undefined;
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
}

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

export const respondToDecision = httpsCallable<
  { cfpId: string; proposalId: string; response: 'confirm' | 'decline'; answers?: Answers },
  CallableResult & { status: 'confirmed' | 'declined' }
>(functions, 'respondToDecision');

/**
 * The organiser's questions. Readable by anyone signed in, so this is a plain
 * document read rather than a callable — the speaker's page needs it before it
 * can render the confirmation.
 */
export async function loadConfirmForm(cfpId: string): Promise<ConfirmForm> {
  const snap = await getDoc(doc(db, 'cfps', cfpId, 'config', 'confirmForm'));
  const fields = snap.exists() ? snap.data().fields : null;
  return Array.isArray(fields) ? ({ fields } as ConfirmForm) : EMPTY_FORM;
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
export async function loadSubmissionForm(cfpId: string): Promise<SubmissionForm> {
  const snap = await getDoc(doc(db, 'cfps', cfpId, 'config', 'submissionForm'));
  return mergeSubmissionForm(snap.exists() ? snap.data() : undefined);
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
