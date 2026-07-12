'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Rendered instead of children when a child throws during render. */
  fallback: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Isolates a single GenUI card render. A malformed card that slips past
 * validateGedoCard (or a renderer bug) must never take down the whole message
 * thread — the app has no top-level ErrorBoundary — so we contain it here and
 * show the raw-JSON fallback instead.
 */
export default class CardErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[GenUI] card render failed, showing raw fallback:', error);
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
