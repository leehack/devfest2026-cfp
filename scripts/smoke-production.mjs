const origin = (process.env.CFP_SMOKE_ORIGIN ?? 'https://cfp.gdgmontreal.com').replace(/\/+$/, '');
const cfpId = process.env.CFP_SMOKE_ID ?? 'devfest-mtl-2026';
const authHandler =
  process.env.CFP_SMOKE_AUTH_HANDLER ??
  'https://devfest-mtl-2026-cfp.firebaseapp.com/__/auth/handler';
const timeoutMs = Number(process.env.CFP_SMOKE_TIMEOUT_MS ?? 10_000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  Number.isFinite(timeoutMs) && timeoutMs > 0,
  'CFP_SMOKE_TIMEOUT_MS must be a positive number of milliseconds',
);

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

async function response(path) {
  const url = path.startsWith('http') ? path : `${origin}${path}`;
  const result = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert(result.status === 200, `${url}: expected 200, got ${result.status}`);
  return result;
}

const home = await response('/');
for (const [header, expected] of [
  ['strict-transport-security', /max-age=\d{7,}/],
  ['x-content-type-options', /^nosniff$/],
  ['referrer-policy', /^strict-origin-when-cross-origin$/],
  ['x-frame-options', /^SAMEORIGIN$/],
]) {
  const value = home.headers.get(header) ?? '';
  check(expected.test(value), `${origin}: missing or invalid ${header}`);
}

const permissions = home.headers.get('permissions-policy') ?? '';
for (const capability of ['camera', 'geolocation', 'microphone', 'payment', 'usb']) {
  check(permissions.includes(`${capability}=()`), `${origin}: ${capability} is not disabled`);
}
check(!home.headers.has('x-powered-by'), `${origin}: still exposes X-Powered-By`);

const cfp = await response(`/c/${encodeURIComponent(cfpId)}`);
check(
  (cfp.headers.get('cache-control') ?? '').includes('private, no-store'),
  `${origin}/c/${cfpId}: public CFP response is cacheable`,
);

const robots = await (await response('/robots.txt')).text();
for (const path of ['admin', 'review', 'submit']) {
  check(
    robots.includes(`Disallow: /c/*/${path}`),
    `${origin}/robots.txt: missing CFP ${path} routes`,
  );
}

const sitemap = await (await response('/sitemap.xml')).text();
check(sitemap.includes(origin), `${origin}/sitemap.xml: canonical origin is missing`);
const cfpUrl = `${origin}/c/${encodeURIComponent(cfpId)}`;
check(sitemap.includes(cfpUrl), `${origin}/sitemap.xml: ${cfpUrl} is missing`);

await response(authHandler);
if (failures.length) {
  throw new Error(`Production smoke failed:\n- ${failures.join('\n- ')}`);
}
console.log(`Production smoke passed for ${origin} and ${cfpId}.`);
