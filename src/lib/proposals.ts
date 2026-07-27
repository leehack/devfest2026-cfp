import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import { mapEmpty, toDocuments, type FormState } from './formState';
import type { ProposalStatus } from '@shared/enums';
import type { SessionizeProfile } from '@shared/sessionize';

export interface CfpWindow {
  opensAt: Date;
  closesAt: Date;
  paused: boolean;
  state: 'before' | 'open' | 'paused' | 'closed';
}

export async function loadCfpWindow(): Promise<CfpWindow | null> {
  const snap = await getDoc(doc(db, 'config', 'cfp'));
  if (!snap.exists()) return null;

  const data = snap.data() as { opensAt: Timestamp; closesAt: Timestamp; paused: boolean };
  const opensAt = data.opensAt.toDate();
  const closesAt = data.closesAt.toDate();
  const now = Date.now();

  // Advisory only. The rules and submitProposal re-check against the server
  // clock — this just decides what the page renders.
  let state: CfpWindow['state'] = 'open';
  if (data.paused) state = 'paused';
  else if (now < opensAt.getTime()) state = 'before';
  else if (now >= closesAt.getTime()) state = 'closed';

  return { opensAt, closesAt, paused: data.paused, state };
}

export interface LoadedProposal {
  id: string;
  status: ProposalStatus;
  proposal: Record<string, any>;
  speaker: Record<string, any> | undefined;
}

/**
 * §2: no `onSnapshot` on anything list-shaped — ten reviewers on a live list
 * view is how the 50k/day read quota disappears. One-shot, capped at one doc.
 */
export async function loadMyProposal(user: User): Promise<LoadedProposal | null> {
  const q = query(
    collection(db, 'proposals'),
    where('speakerIds', 'array-contains', user.uid),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  const speakerSnap = await getDoc(doc(db, 'speakers', user.uid));

  return {
    id: docSnap.id,
    status: (docSnap.data().status ?? 'draft') as ProposalStatus,
    proposal: docSnap.data(),
    speaker: speakerSnap.exists() ? speakerSnap.data() : undefined,
  };
}

/**
 * Writes both documents. `status` is set to `draft` only on the very first
 * write and never sent again — the rules reject any update that touches it.
 */
export async function saveDraft(
  user: User,
  form: FormState,
  proposalId: string | null,
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
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );

  if (proposalId) {
    await setDoc(
      doc(db, 'proposals', proposalId),
      { ...forWrite(proposalDoc), updatedAt: serverTimestamp() },
      { merge: true },
    );
    return proposalId;
  }

  const created = await addDoc(collection(db, 'proposals'), {
    ...forWrite(proposalDoc),
    speakerIds: [user.uid],
    // The only status a client ever writes, and only here (§6).
    status: 'draft',
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

interface CallableResult {
  ok: boolean;
  proposalId?: string;
  alreadySubmitted?: boolean;
}

export const submitProposal = httpsCallable<{ proposalId: string }, CallableResult>(
  functions,
  'submitProposal',
);

export const withdrawProposal = httpsCallable<{ proposalId: string }, CallableResult>(
  functions,
  'withdrawProposal',
);

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
