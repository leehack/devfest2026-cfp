# Whole-platform persona QA

This directory defines the reusable exploratory test contract for the CFP
platform. It complements the automated suites; it is not a release report and
does not describe one seed run.

- [`persona-flow-handbook.md`](persona-flow-handbook.md) is the source of truth
  for stable persona IDs, seed states, flow IDs, expected outcomes, mutation
  limits, screenshots, accessibility checks, and automated coverage.
- [`persona-fixture-manifest.md`](persona-fixture-manifest.md) defines synthetic
  identities, fixture provisioning boundaries, failure injection, and the
  uncommitted run manifest.
- [`critical-path-17.md`](critical-path-17.md) maps the release-spanning event
  lifecycle to personas, state boundaries, and automated evidence.
- [`minimum-release-rerun.md`](minimum-release-rerun.md) is the executable
  23-flow automation and screenshot evidence selection for release smoke runs.
- [`voiceover-baseline.md`](voiceover-baseline.md) records the native Safari and
  VoiceOver announcements that browser automation cannot substitute for.

Use it when planning a broad regression pass, adding a feature that crosses
roles, or preparing a screenshot-backed release report. Start with the run
protocol, select flows by risk, and record deviations without fixing them during
the observation pass.

The normal automated gate remains:

```bash
npm run verify
```

Exploratory artifacts belong under `output/playwright/`; do not turn them into
the specification or commit personal data with them.
