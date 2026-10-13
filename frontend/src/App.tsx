import { lazy, Suspense, type ComponentType } from "react";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { useLang, useT } from "./i18n";
import { href, ROUTES, useRoute, type Route } from "./lib/router";
import { useCredentials } from "./stores/credentials";
import { useArena, usePlayground } from "./stores/runs";

// One chunk per page — first paint loads only the page you open.
const PAGES: Record<Route, ComponentType> = {
  playground: lazy(() => import("./pages/Playground")),
  arena: lazy(() => import("./pages/Arena")),
  leaderboard: lazy(() => import("./pages/Leaderboard")),
  pricing: lazy(() => import("./pages/Pricing")),
  history: lazy(() => import("./pages/History")),
  endpoints: lazy(() => import("./pages/Endpoints")),
};

export default function App() {
  const t = useT();
  const route = useRoute();
  const { lang, setLang } = useLang();
  const endpointCount = useCredentials((s) => s.endpoints.length);
  const busy: Partial<Record<Route, boolean>> = {
    playground: usePlayground((s) => s.running),
    arena: useArena((s) => s.running),
  };
  const Page = PAGES[route];

  return (
    <div className="min-h-screen">
      <div className="border-b border-sky-900/40 bg-sky-950/40 px-4 py-1.5 text-center text-xs text-sky-200/80">
        🔒 {t("banner.credentials")}
      </div>
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href={href("playground")} className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span>
              Sandroid <span className="text-sky-400">Play & Battle</span>
            </span>
          </a>
          <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
            {ROUTES.map((r) => (
              <a
                key={r}
                href={href(r)}
                aria-current={route === r ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition ${route === r ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-100"}`}
              >
                {t(`nav.${r}`)}
                {r === "endpoints" && endpointCount > 0 && <span className="ml-1.5 text-xs text-sky-400">{endpointCount}</span>}
                {busy[r] && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400 align-middle" aria-label="running" />}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            onClick={() => setLang(lang === "en" ? "id" : "en")}
            aria-label="Language"
          >
            {lang === "en" ? "EN · id" : "ID · en"}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <ErrorBoundary resetKey={route}>
          <Suspense fallback={<p className="text-sm text-slate-500">{t("common.loading")}</p>}>
            <Page />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-600">
        MIT · {t("app.tagline")} ·{" "}
        <a className="hover:text-slate-400" href="/api/docs" target="_blank" rel="noreferrer">
          API
        </a>
      </footer>
    </div>
  );
}
