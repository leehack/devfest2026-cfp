# The redirect-only Hosting release

The default Hosting site cannot be deleted, and removing its config does not
unpublish whatever it last served. So `devfest-mtl-2026-cfp.web.app` and
`.firebaseapp.com` will go on serving a frozen copy of the pre-Next app forever
unless something replaces it — and that copy has the real production config
baked into its bundle, which makes it a working second front door running old
code, not merely a stale page.

This replaces it with 301s to the canonical origin.

## Why not `firebase hosting:disable`

Because `authDomain` is `devfest-mtl-2026-cfp.firebaseapp.com`, and that site is
what answers `/__/auth/handler` — verified, it returns 200 on both `.web.app` and
`.firebaseapp.com`. Google sign-in and email-link sign-in both complete through
it. Whether that reserved namespace survives an *explicitly disabled* site is not
something anyone could establish without disabling it and finding out, and the
cost of being wrong is every sign-in on the platform, during an open call.

A published release with nothing but redirects keeps the site up — so the
namespace keeps working — while removing the stale app. Firebase serves `/__/*`
itself, ahead of user config, so the redirects below cannot shadow it. Verify
that after deploying, not before:

    curl -sI https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler | head -1

## Order matters

**Do not deploy this until `cfp.gdgmontreal.com` is served by App Hosting.** Until
the certificate is minted, that domain is still attached to *this* Hosting site —
so a catch-all redirect to it would send production in a loop.

Check first:

    curl -s https://cfp.gdgmontreal.com/ | grep -o '/_next/static'

Empty means Hosting is still serving it. Wait.

## Deploy

    npx firebase deploy --only hosting --project devfest-mtl-2026-cfp --config hosting-redirect/firebase.json

Then confirm the auth handler still answers, and that the old app is gone:

    curl -sI https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler | head -1   # 200
    curl -sI https://devfest-mtl-2026-cfp.web.app/ | grep -i location                 # 301 to the custom domain
