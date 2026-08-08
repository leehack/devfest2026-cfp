# Whole-platform persona evidence — 2026-08-08

Result: **PASS**. The original browser run passed 264/264 with 195 automatic
full-page screenshots. After closing its three follow-up items, the expanded
release gate passed 266/266 in 4.8 minutes. The 20-flow release selection below
has 46 original curated screenshots; the native VoiceOver follow-up adds two
more Safari checkpoints and a transcript.

Screenshots are visible checkpoints, not the sole transition proof. The
associated Playwright assertions compare routes, persisted emulator data,
authorization results, and pre/post state. The compact results are in
`verification-summary.json`; the original run and follow-up verification are
recorded in `run-manifest.json`. Raw runner output stays local because it embeds
machine-specific paths and duplicates the curated evidence.

| Flow | Persona | Result | Curated evidence |
|---|---|---:|---|
| `PUB-01` | Anonymous visitor | PASS | [listing](curated/anon-public/pub-01--listing--desktop.png), [event hero](curated/anon-public/pub-01--event-hero--desktop.png) |
| `AUTH-01` | Anonymous → speaker | PASS | [signed out](curated/anon-public/auth-01--signed-out-origin--desktop.png), [Google destination](curated/anon-public/auth-01--google-destination--desktop.png), [email-link destination](curated/anon-public/auth-01--email-link-destination--desktop.png) |
| `SPK-02` | Draft speaker | PASS | [saved draft](curated/spk-draft/spk-02--draft-saved--desktop.png), [after reload](curated/spk-draft/spk-02--same-draft-after-reload--desktop.png) |
| `SPK-03` | Submitting speaker | PASS | [localized validation](curated/spk-draft/spk-03--validation-summary--desktop.png), [submitted](curated/spk-draft/spk-03--submitted-state--desktop.png) |
| `SPK-05` | Submitted/withdrawn speaker | PASS | [ready to withdraw](curated/spk-submitted/spk-05--withdraw-ready--desktop.png), [withdrawn](curated/spk-submitted/spk-05--withdrawn-after-reload--desktop.png) |
| `SPK-07` | Accepted speaker | PASS | [accepted](curated/spk-accepted/spk-07--accepted-decision--desktop.png), [required answer](curated/spk-accepted/spk-07--required-error--desktop.png), [confirmed](curated/spk-accepted/spk-07--confirmed-result--desktop.png) |
| `SPK-09` | Confirmed/scheduled speaker | PASS — canonical full-flow E2E | [agenda](curated/spk-confirmed/spk-09--agenda--phone.png), [session detail](curated/spk-confirmed/spk-09--session-detail--desktop.png) |
| `REV-02` | Keyboard reviewer | PASS | [numeric note](curated/reviewer/rev-02--before-score--desktop.png), [advanced card](curated/reviewer/rev-02--counter-next-card--desktop.png), [queue state](curated/reviewer/rev-02--queue-state--desktop.png) |
| `REV-05` | Reviewer leaving/returning | PASS | [note before](curated/reviewer/rev-05--note-before-navigation--desktop.png), [restored note](curated/reviewer/rev-05--restored-note--desktop.png) |
| `REV-06` | Reviewer with failed write | PASS | [before save](curated/reviewer/rev-06--note-before-save--desktop.png), [failure recovery](curated/reviewer/rev-06--save-failure--desktop.png), [successful retry](curated/reviewer/rev-06--successful-recovery--desktop.png) |
| `ADM-05` | Event admin — reviews/decisions | PASS | [coverage](curated/event-admin/adm-05--coverage--desktop.png), [decisions](curated/event-admin/adm-05--decisions--desktop.png), [selected speakers](curated/event-admin/adm-05--selected-speakers--desktop.png) |
| `ADM-06` | Event admin — email | PASS | [pending guidance](curated/event-admin/adm-06--pending-callout--desktop.png), [post-release log](curated/event-admin/adm-06--post-release-log--desktop.png) |
| `ADM-07` | Event admin — schedule | PASS | [blocked mobile editor](curated/event-admin/adm-07--blocked-publish--phone.png), [review/publish](curated/event-admin/adm-07--review-publish--desktop.png), [cancelled public session](curated/event-admin/adm-07--cancelled-session--desktop.png) |
| `OWN-01` | Event owner | PASS | [archived state](curated/event-owner/own-01--archived-state--desktop.png), [frozen response](curated/event-owner/own-01--frozen-response--desktop.png) |
| `PLT-02` | Platform creator | PASS | [created event](curated/platform-creator/plt-02--created-event--desktop.png), [home task](curated/platform-creator/plt-02--home-task-card--desktop.png) |
| `PLT-03` | Platform admin | PASS | [creator controls](curated/platform-admin/plt-03--creator-controls--desktop.png), [denial boundary](curated/platform-admin/plt-03--unrelated-denial--desktop.png) |
| `PLT-04` | Platform owner | PASS | [admin delegation](curated/platform-owner/plt-04--owner-controls--desktop.png), [protected owner](curated/platform-owner/plt-04--protected-owner-state--desktop.png) |
| `MOB-01` | Mobile anonymous visitor | PASS | [320 px agenda](curated/anon-public/mob-01--agenda--phone.png) |
| `A11Y-02` | Keyboard/screen-reader reviewer | PASS — keyboard automation and native VoiceOver | [shortcuts](curated/reviewer/a11y-02--shortcuts--desktop.png), [focus follows advance](curated/reviewer/a11y-02--focused-next-card--desktop.png), [queue](curated/reviewer/a11y-02--queue--desktop.png), [VoiceOver scored return](curated/reviewer/a11y-02--voiceover-scored-return--safari.png), [VoiceOver queue](curated/reviewer/a11y-02--voiceover-queue--safari.png), [transcript](curated/reviewer/a11y-02--spoken-state--desktop-1440x1000.txt) |
| `LOC-01` | French speaker | PASS | [French form](curated/spk-draft/loc-01--french-form--phone.png), [French validation](curated/spk-draft/loc-01--french-validation--desktop.png) |

## Evidence boundaries

- Browser-native confirmation chrome is asserted by Playwright but is not
  included in page-only screenshots.
- `SPK-09` now has one canonical E2E that confirms the accepted speaker,
  publishes the programme, follows the speaker's own session, and compares the
  downloaded ICS field by field.
- VoiceOver spoken-output quality remains native manual evidence rather than a
  browser assertion. The current Safari baseline and transcript are in
  [`docs/qa/voiceover-baseline.md`](../../../../docs/qa/voiceover-baseline.md).
- Firebase/Next development badges and synthetic fixture copy may appear in
  screenshots; no production account, proposal, email, or secret was used.
