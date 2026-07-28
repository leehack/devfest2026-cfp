/**
 * Resend's domain API, just enough of it to set a sending domain up without
 * leaving `/admin`.
 *
 * The DNS records Resend wants are generated per domain and only exist in its
 * dashboard, which is the one part of the setup nobody can be told in advance —
 * so fetch them and show them. Verification is the long pole in the whole email
 * build; anything that shortens the loop between "added a record" and "did that
 * work" is worth the API call.
 */

import { logger } from 'firebase-functions';

const API = 'https://api.resend.com';

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

export interface Domain {
  id: string;
  name: string;
  /** Resend's own vocabulary: not_started, pending, verified, failed. */
  status: string;
  records: DnsRecord[];
}

/**
 * Codes chosen so they cannot be confused with our own.
 *
 * A rejected Resend key is `failed-precondition`, never `unauthenticated`:
 * `unauthenticated` already means "the caller is not signed in", and mapping
 * both onto it told an admin their session had expired when the real problem
 * was the key they had just pasted — advice that could never have worked.
 */
export class ResendError extends Error {
  constructor(
    readonly code: 'failed-precondition' | 'invalid-argument' | 'unavailable' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  if (!apiKey) throw new ResendError('failed-precondition', 'No Resend API key is set.');

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    throw new ResendError('unavailable', `Could not reach Resend: ${String(error)}`);
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, any>;

  if (response.status === 401 || response.status === 403) {
    // 403 is usually a *valid* key without full access: `/domains` needs it,
    // `/emails` does not, so a sending-only key fails here and nowhere else.
    throw new ResendError('failed-precondition', 'Resend rejected the API key.');
  }
  if (response.status === 404) throw new ResendError('not-found', 'No such domain at Resend.');
  if (!response.ok) {
    // Resend puts the useful part in `message`; the status alone says nothing.
    throw new ResendError('invalid-argument', body.message ?? `Resend returned ${response.status}`);
  }
  return body as T;
}

const shape = (d: Record<string, any>): Domain => ({
  id: String(d.id ?? ''),
  name: String(d.name ?? ''),
  status: String(d.status ?? 'unknown'),
  records: Array.isArray(d.records) ? (d.records as DnsRecord[]) : [],
});

export async function listDomains(apiKey: string): Promise<Domain[]> {
  const body = await call<{ data?: Record<string, any>[] }>(apiKey, '/domains');
  return (body.data ?? []).map(shape);
}

/** The list endpoint omits `records`, so a caller that needs them asks by id. */
export async function getDomain(apiKey: string, id: string): Promise<Domain> {
  return shape(await call<Record<string, any>>(apiKey, `/domains/${id}`));
}

export async function addDomain(apiKey: string, name: string): Promise<Domain> {
  const created = await call<Record<string, any>>(apiKey, '/domains', {
    method: 'POST',
    body: { name },
  });
  logger.info('domain added at Resend', { name, id: created.id });
  return shape(created);
}

/**
 * Asks Resend to re-check DNS. It answers immediately and verifies in the
 * background, so the caller re-reads the domain rather than trusting this.
 */
export async function verifyDomain(apiKey: string, id: string): Promise<Domain> {
  await call(apiKey, `/domains/${id}/verify`, { method: 'POST' });
  return getDomain(apiKey, id);
}

/** A bare hostname. Rejects a pasted URL or address before Resend has to. */
export function cleanDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const bare = trimmed.includes('@') ? trimmed.split('@')[1] : trimmed;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null;
}
