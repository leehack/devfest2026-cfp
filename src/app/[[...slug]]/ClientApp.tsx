'use client';

import { App } from '../../App';
import { ErrorBoundary } from '../../components/ErrorBoundary';

/** The client boundary. Nothing above this line ships to the browser. */
export function ClientApp({ initialPath }: { initialPath: string }) {
  return (
    <ErrorBoundary>
      <App initialPath={initialPath} />
    </ErrorBoundary>
  );
}
