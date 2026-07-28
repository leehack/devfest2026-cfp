/**
 * A call for proposals, as a tenant.
 *
 * The id *is* the slug. A CFP lives at `/c/devfest-mtl-2026`, and making that
 * the document id means Firestore's own "a document id is unique" is the
 * uniqueness check — there is no second index to keep honest, and no window in
 * which two people both believe they own the name.
 *
 * Compiled into both bundles, so validation is the same sentence on the client
 * and in the callable that actually enforces it.
 */

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Who someone is to one CFP. Ordered: each can do everything below it. Speaker
 * is not a role — anyone signed in may submit, so it needs no record.
 *
 *   owner      archives, deletes and changes who owns it
 *   admin      grants roles, moves the window, decides and sends
 *   reviewer   scores proposals — but never one they are speaking on
 */
export const CFP_ROLES = ['owner', 'admin', 'reviewer'] as const;
export type CfpRole = (typeof CFP_ROLES)[number];

/**
 * What an admin may hand out. `owner` is deliberately absent: it is written once
 * to whoever created the CFP, because otherwise an admin could promote
 * themselves and then archive the thing out from under its owner.
 */
export const GRANTABLE_ROLES = ['admin', 'reviewer'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const CFP_LIMITS = {
  idMin: 3,
  idMax: 60,
  nameMax: 120,
  /** Per account. A platform anyone can create on needs a ceiling somewhere. */
  perOwner: 10,
} as const;

/**
 * Lower case, digits and single hyphens. Deliberately narrow: this string ends
 * up in a URL, in a Storage path and in a Firestore document id, and the three
 * of them do not agree about what is safe. A leading `__` is a reserved
 * Firestore id, and `.`/`..` are reserved everywhere.
 */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type CfpProblem = 'idFormat' | 'idLength' | 'nameEmpty' | 'nameLong' | 'visibility';

export function validateCfpId(id: string): CfpProblem | null {
  if (id.length < CFP_LIMITS.idMin || id.length > CFP_LIMITS.idMax) return 'idLength';
  return ID.test(id) ? null : 'idFormat';
}

export function validateCfp(input: { id: string; name: string; visibility: string }): CfpProblem | null {
  const id = validateCfpId(input.id);
  if (id) return id;

  const name = input.name.trim();
  if (!name) return 'nameEmpty';
  if (name.length > CFP_LIMITS.nameMax) return 'nameLong';

  return (VISIBILITIES as readonly string[]).includes(input.visibility) ? null : 'visibility';
}

/**
 * A name turned into a usable id — what the create form offers before anyone
 * types their own. Not authoritative: `validateCfpId` is, and the callable runs
 * it again on whatever actually arrives.
 */
export function idFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CFP_LIMITS.idMax)
    .replace(/-+$/, '');
}
