import type { FormState } from './formState';

/**
 * The Sessionize profile this speaker has already told us about, wherever they
 * put it — so nobody has to go and find their own profile URL to paste it back
 * in, at this CFP and at the next one.
 *
 * The profile field first, since that is the one they were asked for. The scan
 * through Links is the fallback for everybody who put it there before the field
 * existed, and for anybody who lists it there instead.
 *
 * Its own module rather than part of the component: it is a pure function of the
 * form, and this is what keeps the unit suite from importing a `.tsx` — and with
 * it React and the Firebase SDK — to test four lines.
 */
export function knownSessionizeUrl(form: FormState): string {
  if (form.sessionizeUrl.trim()) return form.sessionizeUrl.trim();
  const link = form.socials.find((s) => /(^|\/\/|\.)sessionize\.com\//i.test(s.handle.trim()));
  return link?.handle.trim() ?? '';
}
