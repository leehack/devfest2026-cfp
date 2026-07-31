import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const requireFromFunctions = createRequire(resolve('functions/package.json'));
const requireFromRoot = createRequire(resolve('package.json'));

describe('dependency security overrides', () => {
  it('keeps minimatch and brace-expansion API-compatible', () => {
    const { braceExpand } = requireFromFunctions('minimatch') as {
      braceExpand(pattern: string): string[];
    };

    expect(braceExpand('talk-{en,fr}')).toEqual(['talk-en', 'talk-fr']);
  });

  it('keeps the Google client UUID API available after its security upgrade', () => {
    const { v4 } = requireFromFunctions('uuid') as { v4(): string };
    expect(v4()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('loads the patched image processor used by the Next runtime', () => {
    const sharp = requireFromRoot('sharp') as {
      versions: { sharp: string };
    };
    expect(sharp.versions.sharp).toBe('0.35.3');
  });
});
