import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const requireFromFunctions = createRequire(resolve('functions/package.json'));

describe('server dependency overrides', () => {
  it('keeps minimatch and brace-expansion API-compatible', () => {
    const { braceExpand } = requireFromFunctions('minimatch') as {
      braceExpand(pattern: string): string[];
    };

    expect(braceExpand('talk-{en,fr}')).toEqual(['talk-en', 'talk-fr']);
  });
});
