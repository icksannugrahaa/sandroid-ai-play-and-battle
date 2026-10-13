import { Component, type ReactNode } from "react";

import { translate, useLang } from "../i18n";

interface State {
  error: Error | null;
}

/** Keeps one broken page from blanking the app. Stale chunks after a redeploy get a reload prompt. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const lang = useLang.getState().lang;
    const stale = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className="card space-y-3 text-sm">
        <p>{translate(lang, stale ? "app.updated" : "app.crashed")}</p>
        <p className="text-xs text-amber-300/80">{translate(lang, "banner.credentials")}</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          {translate(lang, "app.reload")}
        </button>
      </div>
    );
  }
}
