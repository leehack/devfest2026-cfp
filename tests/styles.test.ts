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

describe('status contrast tokens', () => {
  it('uses theme-tested foreground pairs for schedule duration and email attention text', () => {
    const duration = css.match(/\.schedule-resize-inspector__value\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(duration).toMatch(/background\s*:\s*var\(--accent\)/);
    expect(duration).toMatch(/color\s*:\s*var\(--accent-fg\)/);

    for (const selector of [
      '.email-attention-card--active .email-attention-card__count',
      '.pending-email-notice--attention .pending-email-notice__eyebrow',
      '.subnav__badge--attention',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const declaration = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(declaration).toMatch(/color\s*:\s*var\(--error\)/);
    }
  });
});

describe('platform limits layout', () => {
  it('does not leak platform-org-limit grid-area to platform-global-limit', () => {
    const globalField = css.match(/\.platform-global-limit__field\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(globalField).not.toMatch(/grid-area\s*:/);
    expect(globalField).toMatch(/display\s*:\s*grid/);
  });
});
