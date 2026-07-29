/**
 * A Firestore Timestamp, an ISO string, or anything else that names a moment.
 * Returns null rather than an Invalid Date, so callers cannot render one.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value === null || value === undefined || value === '') return null;
  /*
   * Epoch millis, which is how a Timestamp survives being handed from the server
   * to the browser — a Timestamp itself does not serialise. Before the branch
   * existed this fell through to `new Date(String(value))`, where a number is
   * either an Invalid Date or, worse, read as a year.
   */
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  const at = new Date(String(value));
  return Number.isNaN(at.valueOf()) ? null : at;
}

/**
 * Formats an instant for a `datetime-local` input, which has no timezone and
 * means local wall-clock — which is also how an admin reads a deadline. The
 * shift is what makes the round trip through `new Date(value)` land back on the
 * same instant; `toISOString().slice(0, 16)` would silently move the deadline by
 * the UTC offset.
 */
export function toDateTimeInput(date: Date | null): string {
  if (!date) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
