/**
 * One Resend account serves every CFP, so its domain ids are platform-wide.
 * A per-CFP config pointer is usable only when the matching platform binding
 * names that same CFP. The hash keeps an opaque provider id safe as a Firestore
 * document id even if Resend ever changes its format.
 */

import { createHash } from 'node:crypto';

import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

export function emailDomainBindingId(domainId: string): string {
  return createHash('sha256').update(domainId).digest('hex');
}

export function emailDomainBindingRef(db: Firestore, domainId: string) {
  return db.doc(`emailDomainBindings/${emailDomainBindingId(domainId)}`);
}

export function emailDomainBindingMatches(
  binding: DocumentData | undefined,
  cfpId: string,
  domainId: string,
  domain: string,
): boolean {
  return Boolean(
    domainId &&
      domain &&
      (binding?.scope === undefined || binding?.scope === 'event') &&
      binding?.cfpId === cfpId &&
      binding?.domainId === domainId &&
      String(binding?.domain ?? '').toLowerCase() === domain.toLowerCase(),
  );
}

export function platformEmailDomainBindingMatches(
  binding: DocumentData | undefined,
  domainId: string,
  domain: string,
): boolean {
  return Boolean(
    domainId &&
      domain &&
      binding?.scope === 'platform' &&
      binding?.domainId === domainId &&
      String(binding?.domain ?? '').toLowerCase() === domain.toLowerCase(),
  );
}

export function supersededStagedEmailDomainId(
  stagedDomainId: string,
  activeDomainId: string,
  replacementDomainId: string,
): string | null {
  return stagedDomainId &&
    stagedDomainId !== activeDomainId &&
    stagedDomainId !== replacementDomainId
    ? stagedDomainId
    : null;
}

export function legacyEmailDomainOwnerIsExact(
  cfpId: string,
  domain: string,
  references: ReadonlyArray<{ cfpId: string; domain: string }>,
): boolean {
  return (
    references.length === 1 &&
    references[0].cfpId === cfpId &&
    references[0].domain.toLowerCase() === domain.toLowerCase()
  );
}

export async function emailDomainIsBound(
  db: Firestore,
  cfpId: string,
  config: DocumentData,
): Promise<boolean> {
  const domainId = String(config.domainId ?? '');
  const domain = String(config.domain ?? '');
  if (!domainId || !domain) return false;
  const binding = await emailDomainBindingRef(db, domainId).get();
  return emailDomainBindingMatches(binding.data(), cfpId, domainId, domain);
}

function cfpIdFromEmailConfig(snapshot: QueryDocumentSnapshot): string | null {
  const parts = snapshot.ref.path.split('/');
  return parts.length === 4 && parts[0] === 'cfps' && parts[2] === 'config' && parts[3] === 'email'
    ? parts[1]
    : null;
}

/** One-time safe migration for configs written before platform bindings existed. */
export async function ensureLegacyEmailDomainBinding(
  db: Firestore,
  cfpId: string,
  config: DocumentData,
): Promise<boolean> {
  const domainId = String(config.domainId ?? '');
  const domain = String(config.domain ?? '').toLowerCase();
  if (!domainId || !domain) return false;
  if (await emailDomainIsBound(db, cfpId, config)) return true;

  return db.runTransaction(async (tx) => {
    const bindingRef = emailDomainBindingRef(db, domainId);
    const configRef = db.doc(`cfps/${cfpId}/config/email`);
    const [cfp, currentConfig, binding] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      configRef,
      bindingRef,
    );
    if (
      !cfp.exists ||
      cfp.get('archived') === true ||
      cfp.get('deleting') === true ||
      currentConfig.get('domainId') !== domainId ||
      String(currentConfig.get('domain') ?? '').toLowerCase() !== domain
    ) {
      return false;
    }
    if (binding.exists) {
      return emailDomainBindingMatches(binding.data(), cfpId, domainId, domain);
    }

    const snapshots = await tx.get(
      db.collectionGroup('config').where('domainId', '==', domainId),
    );
    const references = snapshots.docs
      .map((snapshot) => ({
        cfpId: cfpIdFromEmailConfig(snapshot),
        domain: String(snapshot.get('domain') ?? ''),
      }))
      .filter((entry): entry is { cfpId: string; domain: string } => Boolean(entry.cfpId));
    if (!legacyEmailDomainOwnerIsExact(cfpId, domain, references)) return false;

    tx.create(bindingRef, {
      scope: 'event',
      cfpId,
      domainId,
      domain,
      assignedBy: 'legacy-migration',
      migrated: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}
