import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default class AppErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Application render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] p-6 text-[var(--text-primary)]">
        <section role="alert" className="glass-panel w-full max-w-lg rounded-lg p-6">
          <AlertCircle className="h-6 w-6 text-pink-500" />
          <h1 className="mt-3 text-xl font-bold">This page could not be displayed</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Your data has not been changed. Reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
            <RotateCcw className="h-4 w-4" />Reload page
          </button>
        </section>
      </main>
    );
  }
}