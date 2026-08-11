type ComparableScheduleEntry = {
  date?: unknown;
  startsAt?: unknown;
  durationMinutes?: unknown;
  roomId?: unknown;
  session?: unknown;
  cancelled?: unknown;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function sessionWithoutSpeakers(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const session = { ...(value as Record<string, unknown>) };
  delete session.speakers;
  return stableValue(session);
}

/**
 * Schedule mail promises that a placement changed. Public speaker metadata and
 * photos belong to the programme release, but are not a placement change.
 */
export function placementNotificationChanged(
  previous: ComparableScheduleEntry,
  current: ComparableScheduleEntry,
  previousRoomName: unknown,
  currentRoomName: unknown,
  timeZoneChanged: boolean,
): boolean {
  return (
    previous.date !== current.date ||
    previous.startsAt !== current.startsAt ||
    previous.durationMinutes !== current.durationMinutes ||
    previous.roomId !== current.roomId ||
    JSON.stringify(stableValue(previousRoomName)) !== JSON.stringify(stableValue(currentRoomName)) ||
    timeZoneChanged ||
    JSON.stringify(sessionWithoutSpeakers(previous.session)) !==
      JSON.stringify(sessionWithoutSpeakers(current.session)) ||
    previous.cancelled === true
  );
}

function speakerIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((uid) => typeof uid === 'string' && Boolean(uid)) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return [...value] as string[];
}

/** Prefer the immutable release roster, with the late-speaker baseline for legacy releases. */
export function previousReleaseSpeakerIds(
  hasPreviousRelease: boolean,
  storedByProposal: unknown,
  proposalId: string,
  legacyFallback: readonly string[],
): string[] {
  if (!hasPreviousRelease) return [];
  if (storedByProposal && typeof storedByProposal === 'object' && !Array.isArray(storedByProposal)) {
    const stored = speakerIds((storedByProposal as Record<string, unknown>)[proposalId]);
    if (stored) return stored;
  }
  return [...new Set(legacyFallback.filter(Boolean))];
}

export function newlyScheduledSpeakerIds(
  current: readonly string[],
  previous: readonly string[],
): string[] {
  const previousSet = new Set(previous);
  return [...new Set(current.filter(Boolean))].filter((uid) => !previousSet.has(uid));
}
