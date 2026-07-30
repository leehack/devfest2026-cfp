import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('link-shaped actions', () => {
  it('cannot inherit an unreadable global visited-link foreground', () => {
    const globalVisited = css.match(/(?:^|\n)\s*a:visited\s*\{([^}]*)\}/)?.[1] ?? '';
    const globalOverridesForeground = /(?:^|;)\s*color\s*:/.test(globalVisited);
    const primaryVisited = css.match(/\.btn--primary:visited[^{]*\{([^}]*)\}/)?.[1] ?? '';
    const primaryRestoresForeground = /(?:^|;)\s*color\s*:/.test(primaryVisited);

    expect(globalOverridesForeground && !primaryRestoresForeground).toBe(false);
  });

  it('does not let a visited base button override ghost modifiers', () => {
    expect(css).not.toMatch(/\.btn\s*,\s*\.btn:visited\s*\{/);

    const ghost = css.match(/\.btn--ghost\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ghost).toMatch(/background\s*:\s*transparent/);
  });
});
