import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { adoptLegacyHash } from './lib/router';
import './styles.css';

// Before the first render, so nothing ever reads the old URL and decides it
// means home.
adoptLegacyHash();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
