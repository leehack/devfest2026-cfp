# VoiceOver baseline

Native screen-reader evidence for flows that cannot be reduced to browser DOM
assertions. Refresh this baseline after changing focus management, live regions,
review navigation, or the accessible names of the controls below.

## A11Y-02 reviewer deck — 2026-08-08

### Environment

- macOS 26.5.2 (25F84)
- Safari 26.5.2 (21624.2.5.11.8)
- macOS VoiceOver with the caption panel enabled
- Local Firebase emulator suite and Safari against `http://localhost:5173`
- Synthetic reviewer with three submitted proposals; no production accounts or
  data

VoiceOver was off before the pass, enabled only for this journey, and restored
to off afterwards.

### Transcript

The quoted content below is the native Safari/VoiceOver focus or selection
output. Roles and states are included where the macOS accessibility surface
reported them.

1. Enter the page and interact with its web content.
   - “Review talks — DevFest Montréal 2026 — Call for Proposals, web content”
   - “Skip to content, link”
2. Sign in with the synthetic reviewer, then open shortcuts with `Shift+/`.
   - “Shortcuts, expanded, button”
   - “1–4, Score, and move to the next one”
   - “Left/right arrow (J/K), Back and forward without scoring”
   - “Question mark, Show or hide this”
3. Move to the committee note and enter `Needs 3 concrete examples.`
   - “Notes for the committee, Optional, text area”
   - The progress remained “0 of 3 scored”; the digit in the note did not score
     the proposal.
4. Leave the note, press `3`, and wait for the write.
   - “Beta on queues” received focus as the next proposal.
   - The progress changed to “2 of 3” and “1 of 3 scored”.
5. Open the review queue through the native accessibility action.
   - “Review queue, heading”
   - “1, Alpha on caching, Scored, button”
   - “2, Beta on queues, Current, Not scored” — deliberately not a button
   - “3, Gamma on tracing, Not scored, button”
6. Activate the scored Alpha row.
   - “Alpha on caching” received focus.
   - “1 of 3” and “1 of 3 scored” remained accurate.
   - “3 — Yes, toggle button, on” exposed the saved score state.

### Result

Pass. The native pass confirmed the shortcut disclosure, text-input guard,
single-step auto-advance, named focus transfer, progress update, queue state,
and return to the scored proposal. The caption panel was enabled, although its
overlay is excluded from macOS screen capture; this transcript was recorded
from the native VoiceOver selection/focus stream and role/state output, not a
synthetic browser accessibility snapshot.

Screenshots from the same pass:

- [`a11y-02--voiceover-scored-return--safari.png`](../../output/playwright/persona-report/2026-08-08-whole-platform/curated/reviewer/a11y-02--voiceover-scored-return--safari.png)
- [`a11y-02--voiceover-queue--safari.png`](../../output/playwright/persona-report/2026-08-08-whole-platform/curated/reviewer/a11y-02--voiceover-queue--safari.png)
- [`a11y-02--spoken-state--desktop-1440x1000.txt`](../../output/playwright/persona-report/2026-08-08-whole-platform/curated/reviewer/a11y-02--spoken-state--desktop-1440x1000.txt)
