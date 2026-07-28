/**
 * The platform's own settings — `config/platform`.
 *
 * Deliberately not editable from any admin screen. `publicUrl` is the origin of
 * every link the server mails, including sign-in links, which are bearer
 * credentials: an organiser who could edit it could aim another CFP's sign-in
 * mail at a host they control. So it lives one level above every tenant, and
 * changing it is a deploy-time act rather than a form.
 *
 * Everything here is optional. Unset, the server derives the URL from the
 * project's own Hosting domain, which is right for a fresh project or a fork.
 *
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform.mjs \
 *     --url https://cfp.example.org --name "Call for proposals"
 */

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const url = arg('url');
const name = arg('name');
/** Who sign-in mail comes from when it is not about any one CFP. */
const from = arg('from');

if (!url && !name && !from) {
  console.error('Usage: node scripts/set-platform.mjs [--url https://…] [--name "…"] [--from "…"]');
  process.exit(1);
}
if (url && !/^https?:\/\/[^\s/]+\.[^\s/]+/.test(url)) {
  console.error('The URL needs a scheme and a domain, e.g. https://cfp.example.org');
  process.exit(1);
}

initializeApp();

await getFirestore()
  .doc('config/platform')
  .set(
    {
      // Trailing slash trimmed here rather than at render: it is one place, and
      // "https://x.org/" + a path is the kind of double slash nobody notices
      // until it is in mail that has already gone out.
      ...(url ? { publicUrl: url.replace(/\/+$/, '') } : {}),
      ...(name ? { name } : {}),
      ...(from ? { from } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

console.log('config/platform written.');
process.exit(0);
