import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase';
import { usingEmulators } from './emulators';

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  sub: string;
  badge: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'owner', name: 'Olivia Owner', email: 'owner@example.org', sub: 'usr-owner', badge: '👑 Platform & Event Owner' },
  { id: 'admin', name: 'Alice Admin', email: 'admin@example.org', sub: 'usr-admin', badge: '🛡️ Event Admin' },
  { id: 'reviewer', name: 'Bob Reviewer', email: 'reviewer@example.org', sub: 'usr-reviewer', badge: '⚖️ Committee Reviewer' },
  { id: 'speaker', name: 'Charlie Speaker', email: 'speaker@example.org', sub: 'usr-speaker', badge: '🎤 Speaker with Talks' },
  { id: 'manager', name: 'Morgan Manager', email: 'manager@example.org', sub: 'usr-manager', badge: '🏢 Org Team Member' },
];

/**
 * Emulator-only sign-in. `signInWithPopup` needs a real popup to post back to,
 * so it is unusable in headless browsers, embedded webviews and CI; the Auth
 * emulator accepts an unsigned ID token, so mint one and skip the IdP.
 */
export async function signInAsTestSpeaker(profile?: {
  sub?: string;
  email?: string;
  name?: string;
}) {
  if (!usingEmulators) {
    throw new Error('Test sign-in is only available against the emulator suite.');
  }

  const claims = {
    sub: profile?.sub ?? 'test-speaker',
    email: profile?.email ?? 'test.speaker@example.org',
    email_verified: true,
    name: profile?.name ?? 'Test Speaker',
  };

  return signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(claims)));
}

export async function signInAsDemoAccount(account: DemoAccount) {
  return signInAsTestSpeaker({
    sub: account.sub,
    email: account.email,
    name: account.name,
  });
}

export function installTestSignIn(): void {
  if (!usingEmulators) return;
  (window as unknown as Record<string, unknown>).signInAsTestSpeaker = signInAsTestSpeaker;
}
