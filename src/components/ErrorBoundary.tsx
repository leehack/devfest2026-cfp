import { Component, type ReactNode } from 'react';
import { dictionaries } from '../i18n';
import { detectLocale } from '../i18n/context';

/**
 * Without this, a render error unmounts the tree and leaves a blank white page —
 * indistinguishable from a broken deploy, and an applicant mid-draft has no idea
 * their autosaved work is still safe.
 *
 * Reads the dictionary directly rather than through context: the provider is
 * above it, but a boundary that depends on its own subtree is one crash away
 * from being useless.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('unhandled render error', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = dictionaries[detectLocale()];
    return (
      <div className="page">
        <div className="panel">
          <p>{t.errors.crashed}</p>
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
            {t.errors.reload}
          </button>
        </div>
      </div>
    );
  }
}
