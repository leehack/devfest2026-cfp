import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('lifecycle trigger delivery', () => {
  it('retries proposal-driven schedule cancellation after transient failures', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../functions/src/index.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(
      /export const cancelPublishedSession = onDocumentWritten\(\s*\{[\s\S]*?retry: true,[\s\S]*?\},/,
    );
  });
});
