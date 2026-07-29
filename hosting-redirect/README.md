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

**Do not deploy this until `cfp.gdgmontreal.com` is served by App Hosting.**

There were two reasons, and only one is still live.

The loop is no longer possible. It would have been, while the domain's DNS still
pointed at Hosting: a catch-all redirect to a domain Hosting itself was serving
sends production round in a circle. That ended when the A record moved to App
Hosting's edge — Hosting cannot receive a request for a name that does not
resolve to it, whether or not the domain object is still attached to the site.

What is left is smaller and still worth waiting for: until App Hosting finishes
binding the domain, its edge answers 404, so deploying early would point the old
front door at a missing page instead of a working one. There is nothing to gain
by getting there first.

Check the destination, not the source — a 200 from the edge itself:

    curl -s -o /dev/null -w '%{http_code}\n' \
      --resolve cfp.gdgmontreal.com:443:35.219.200.192 https://cfp.gdgmontreal.com/

`--resolve` because a local resolver can hold the old CNAME for its full hour
and answer from Hosting long after the zone stopped saying so. 404 means the
backend has not claimed the domain yet. Wait.

## Deploy

    npx firebase deploy --only hosting --project devfest-mtl-2026-cfp --config hosting-redirect/firebase.json

Then confirm the auth handler still answers, and that the old app is gone:

    curl -sI https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler | head -1   # 200
    curl -sI https://devfest-mtl-2026-cfp.web.app/ | grep -i location                 # 301 to the custom domain
