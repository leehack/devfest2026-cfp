/** A direct session selection is distinct from the two-part invitation link. */
export function proposalSelectionQuery(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has('speakerInvite')) return null;
  return params.get('proposal')?.trim() || null;
}
