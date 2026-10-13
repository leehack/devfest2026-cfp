/** A direct session selection is distinct from the two-part invitation link. */
export function proposalSelectionQuery(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has('speakerInvite') || params.has('lateInvite')) return null;
  return params.get('proposal')?.trim() || null;
}

export function lateSubmissionInviteQuery(search: string): string | null {
  const params = new URLSearchParams(search);
  const token = params.get('lateInvite')?.trim() || '';
  if (!token || token.includes('/') || token.length > 120) return null;
  return token;
}
