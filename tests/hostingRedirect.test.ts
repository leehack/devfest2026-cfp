import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Redirect {
  source?: string;
  regex?: string;
  destination: string;
  type: number;
}

const config = JSON.parse(readFileSync('hosting-redirect/firebase.json', 'utf8')) as {
  hosting: { redirects: Redirect[] };
};

function redirectRegex(pattern: string): RegExp {
  // RE2 spells named captures `?P<name>`; JavaScript spells them `?<name>`.
  return new RegExp(pattern.replace(/\(\?P<([A-Za-z][A-Za-z0-9_]*)>/g, '(?<$1>'));
}

describe('the redirect-only Hosting release', () => {
  it('keeps the root redirect explicit', () => {
    expect(config.hosting.redirects[0]).toMatchObject({
      source: '/',
      destination: 'https://cfp.gdgmontreal.com/',
      type: 301,
    });
  });

  it('redirects ordinary paths without swallowing Firebase reserved endpoints', () => {
    const catchAll = config.hosting.redirects.find((entry) => entry.regex);
    expect(catchAll).toMatchObject({
      destination: 'https://cfp.gdgmontreal.com/:rest',
      type: 301,
    });
    expect(catchAll?.source, 'a glob catch-all would swallow Firebase init.json').toBeUndefined();

    const regex = redirectRegex(catchAll!.regex!);
    for (const path of ['/talk', '/c/devfest-mtl-2026/submit', '/_next/chunk.js', '/_']) {
      expect(regex.exec(path)?.groups?.rest, path).toBe(path.slice(1));
    }
    for (const path of [
      '/__',
      '/__/',
      '/__/auth/action',
      '/__/auth/handler',
      '/__/firebase/init.json',
    ]) {
      expect(regex.test(path), path).toBe(false);
    }
  });
});
