/**
 * `apphosting.yaml` before a rollout tries it.
 *
 * Nothing validated this file. `firebase deploy` uploads it, the buildpack parses
 * it in the cloud, and a mistake costs a failed rollout and a trip to the Cloud
 * Build log to find out why. The specific mistake that prompted this: a variable
 * declared with `value: ''`, which App Hosting rejects with "either 'value' or
 * 'secret' field is required" — there is no declared-but-blank variable.
 *
 * Parsed by hand rather than with a YAML library. The repo has no yaml dependency
 * and this file is a flat list; adding one to read nine lines is the worse trade.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Entry {
  variable: string;
  hasValue: boolean;
  hasSecret: boolean;
  availability: string[];
  line: number;
}

function envEntries(): Entry[] {
  const lines = readFileSync('apphosting.yaml', 'utf8').split('\n');
  const entries: Entry[] = [];
  let current: Entry | null = null;
  let readingAvailability = false;

  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // A commented-out variable is not declared.
    const start = /^\s*-\s*variable:\s*(\S+)/.exec(line);
    if (start) {
      current = {
        variable: start[1],
        hasValue: false,
        hasSecret: false,
        availability: [],
        line: i + 1,
      };
      entries.push(current);
      readingAvailability = false;
      return;
    }
    if (!current) return;
    /*
     * Unquoted, because `value: ''` is the case this exists for and it is not
     * whitespace — a "is there something after the colon" check passes it happily,
     * which is how the first version of this test passed the very config that had
     * just failed a rollout.
     */
    const value = /^\s+value:\s*(.*)$/.exec(line);
    if (value && value[1].replace(/^['"]|['"]$/g, '').trim() !== '') current.hasValue = true;
    const secret = /^\s+secret:\s*(.*)$/.exec(line);
    if (secret && secret[1].replace(/^['"]|['"]$/g, '').trim() !== '') current.hasSecret = true;
    if (/^\s+availability:\s*$/.test(line)) {
      readingAvailability = true;
      return;
    }
    if (readingAvailability) {
      const scope = /^\s+-\s+(BUILD|RUNTIME)\s*$/.exec(line);
      if (scope) current.availability.push(scope[1]);
    }
  });

  return entries;
}

describe('apphosting.yaml', () => {
  it('gives every variable either a value or a secret', () => {
    const broken = envEntries()
      .filter((e) => !e.hasValue && !e.hasSecret)
      .map((e) => `${e.variable} (line ${e.line})`);
    expect(broken, 'App Hosting refuses these at rollout, not at deploy').toEqual([]);
  });

  it('never gives one both', () => {
    const both = envEntries()
      .filter((e) => e.hasValue && e.hasSecret)
      .map((e) => e.variable);
    expect(both).toEqual([]);
  });

  it('carries the seven public Firebase values as secrets, not literals', () => {
    const entries = envEntries();
    /*
     * They are not secrets in the security sense — they ship to the browser. They
     * are in Secret Manager so that nothing is committed to a public repo, which
     * means a literal here would be the actual mistake being guarded against.
     */
    for (const name of [
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
      'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      'NEXT_PUBLIC_FIREBASE_APP_ID',
      'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',
    ]) {
      const entry = entries.find((e) => e.variable === name);
      expect(entry, `${name} is not declared`).toBeTruthy();
      expect(entry!.hasSecret, `${name} should come from Secret Manager`).toBe(true);
    }
  });

  it('keeps the emulator sign-in off', () => {
    const raw = readFileSync('apphosting.yaml', 'utf8');
    // next.config.ts refuses to build with this on; this catches it a step earlier.
    expect(raw).toMatch(/NEXT_PUBLIC_USE_EMULATORS/);
    expect(raw).not.toMatch(/NEXT_PUBLIC_USE_EMULATORS[\s\S]{0,40}value:\s*'?true'?/);
  });

  it('links the policy speakers must accept', () => {
    const entry = envEntries().find((e) => e.variable === 'NEXT_PUBLIC_COC_URL');
    expect(entry, 'production renders a Code of Conduct checkbox without a link').toBeTruthy();
    expect(entry!.hasValue).toBe(true);
  });

  it('does not make build-only browser configuration a runtime dependency', () => {
    const entries = envEntries();
    for (const entry of entries.filter((e) => e.variable.startsWith('NEXT_PUBLIC_'))) {
      expect(entry.availability, entry.variable).toEqual(['BUILD']);
    }
  });

  it('keeps server-rendered site metadata available at build and runtime', () => {
    const entries = envEntries();
    for (const name of ['SITE_ORIGIN', 'SITE_NAME']) {
      expect(entries.find((e) => e.variable === name)?.availability, name).toEqual([
        'BUILD',
        'RUNTIME',
      ]);
    }
  });
});
