import { Component, type ReactNode } from 'react';
import { reloadApp } from '../version';
import { tr } from '../i18n';

/** A crash shows a reload button instead of a dead screen on the home-screen app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <h2>{tr('Jokin meni pieleen', 'Something went wrong')}</h2>
        <p className="small">{this.state.error}</p>
        <button className="btn primary" onClick={reloadApp}>
          {tr('Lataa uudelleen', 'Reload')}
        </button>
      </div>
    );
  }
}
