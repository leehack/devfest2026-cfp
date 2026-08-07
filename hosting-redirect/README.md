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
namespace keeps working — while removing the stale app.

It is `/__/auth/*` specifically that Firebase serves ahead of user config, not
`/__/*`. Measured against the deployed release: `/__/auth/handler`,
`/__/auth/iframe` and `/__/auth/experiments.js` all answer 200, while
`/__/firebase/init.js`, `/__/firebase/init.json` and `/__/hosting/verification`
are caught by the catch-all and 301 away.

**That was called harmless here, and it was not.** The reasoning was that the
served handler references no `/__/` URL of its own — true of `/__/auth/handler`,
which is what Google sign-in uses and what was tested. It is false of
`/__/auth/action`, which every email sign-in link goes through: `action.js`
fetches `/__/firebase/init.json` from its own origin at runtime. The catch-all
301'd that to `cfp.gdgmontreal.com`, the cross-origin XHR failed CORS preflight,
and the handler rendered `Error encountered` instead of forwarding to
`continueUrl`. Google sign-in kept working the whole time, which is what made it
look like a mail problem: the link was minted and delivered fine, and died on
the hop before the app.

So the catch-all excludes `/__/` — see the `regex` in `firebase.json`. Do not
put a plain `/:rest*` back.

Verify after deploying, not before. **Both**, because the first passes with the
second broken:

    curl -sI https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler | head -1        # 200
    curl -s -o /dev/null -w '%{http_code}\n' \
      https://devfest-mtl-2026-cfp.firebaseapp.com/__/firebase/init.json                   # 200, NOT 301

A 200 on the handler proves the namespace survived. Only the second proves a
sign-in link still completes. `npm run smoke:production` checks both endpoints
along with the canonical site.

The broken redirect was permanent, so repairing Hosting does not repair a
browser that cached the old 301. New email links therefore explicitly use the
equivalent `devfest-mtl-2026-cfp.web.app` action handler; that origin was never in
the previously mailed links and avoids the stale cache. Google popup sign-in
continues to use the configured `.firebaseapp.com` `authDomain`. The Admin SDK's
`linkDomain` option cannot do this — Firebase rejects default Hosting domains —
so `requestSignInLink` rewrites only the matching generated hostname. Do not
expect an already mailed link to change; issue a new one after the Functions
deploy.

## The reconciler lags. Wait it out; do not go looking for a cause

Worth writing down, because the evidence pointed hard at a cause that was not
the cause.

For about forty-five minutes after DNS was correct, App Hosting reported
`hostState: HOST_NON_FAH`, `ownershipState: OWNERSHIP_MISSING`, and a
`requiredDnsUpdates` block instructing us to **remove** a
`CNAME cfp.gdgmontreal.com → devfest-mtl-2026-cfp.web.app`. No such record
existed. All four authoritative nameservers, and every public resolver checked,
returned the A record it had asked for and nothing else. The check looked live —
its `checkTime` advanced with every poll — while the `discovered` set inside it
stayed frozen on the old records.

The tempting inference, which we drew and which was wrong: that the "discovered"
CNAME was really the domain still being attached to the Hosting *site*, reported
by the Hosting API as `DOMAIN_ACTIVE` with `expectedIps: [199.36.158.100]`, and
that two Firebase properties cannot hold one custom domain.

It bound on its own at 17:44Z with the Hosting attachment still in place and
untouched. Both properties held the domain the whole time. `checkTime` is when
the reconciler ran, not when it re-resolved; the states go
`OWNERSHIP_ACTIVE` first, then `HOST_ACTIVE`, and until then the block it
returns is stale rather than instructive.

So: if DNS matches `desired` at the authoritative nameservers, there is nothing
to fix. Poll `customDomainStatus` and wait for `requiredDnsUpdates` to empty.

Detaching the domain from the Hosting site is still worth doing afterwards — it
is an orphaned second claim on a name App Hosting now owns — but it is cleanup,
not a prerequisite. There is no CLI for it; Firebase has never exposed Hosting
custom domains outside the console and the REST API:

    curl -X DELETE -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      -H "x-goog-user-project: devfest-mtl-2026-cfp" \
      https://firebasehosting.googleapis.com/v1beta1/sites/devfest-mtl-2026-cfp/domains/cfp.gdgmontreal.com

or Hosting → the site → the domain → **Delete**. It does not touch `.web.app`,
`.firebaseapp.com`, or the `/__/auth/*` namespace — see below for why those
matter.

## Order matters

**Do not deploy this until `cfp.gdgmontreal.com` is served by App Hosting.**

Two conditions, and neither is about the certificate.

**The backend must answer 200 on the domain.** Until App Hosting binds it, its
edge 404s, so deploying early points the old front door at a missing page.
Check the destination, not the source:

    curl -s -o /dev/null -w '%{http_code}\n' \
      --resolve cfp.gdgmontreal.com:443:35.219.200.192 https://cfp.gdgmontreal.com/

`--resolve` because a local resolver can hold the old CNAME for its full hour and
answer from Hosting long after the zone stopped saying so — which is exactly the
second condition.

**Every resolver must have let go of the old CNAME, or the domain must be detached
from the Hosting site.** This is the loop, and moving the A record did not kill
it. A client whose resolver still has `cfp.gdgmontreal.com → …web.app` cached
connects to Hosting, and Hosting still recognises that Host — the attachment is
live and so is its certificate — so it serves the catch-all redirect, to a name
that same resolver still sends back to Hosting. That is a redirect loop lasting
until the cache expires.

Note which way the risk runs: before this release, a stale-cache client gets the
*old app*, which works. Deploying into that window is the thing that breaks them.
So either detach the domain from the Hosting site (above — then Hosting stops
recognising the Host and the loop cannot form), or wait a full TTL past the DNS
change. The record's TTL is 3600, so an hour after the zone changed is safe
without needing to know which resolvers cached what.

## Deploy

    npx firebase deploy --only hosting --project devfest-mtl-2026-cfp --config hosting-redirect/firebase.json

Two things in the config were wrong the first time it ran, and both were only
visible from outside, so check them rather than reading the file:

- **The root.** `/:rest*` does not match `/`, so the bare `.web.app` address
  404'd — the one address most people have. It needs its own entry.
- **The capture name.** `:splat` is Netlify's. Firebase would emit it literally.

    for p in / /c/devfest-mtl-2026 '/me?code=abc' /deep/nested; do
      curl -s -o /dev/null -w "$p -> %{http_code} %{redirect_url}\n" \
        "https://devfest-mtl-2026-cfp.web.app$p"
    done

Every line must be a 301 to the same path on the canonical origin, query string
intact. Then confirm sign-in survives and the old app is gone:

    curl -sI https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler | head -1   # 200
    curl -sI https://devfest-mtl-2026-cfp.web.app/ | grep -i location                 # 301 to the custom domain
