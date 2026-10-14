import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon, type IconName } from "./components/icons";
import { CommandPalette, type Command } from "./components/palette";
import { useLang, useT } from "./i18n";
import { href, ROUTES, useRoute, type Route } from "./lib/router";
import { useSeo } from "./lib/seo";
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

const ROUTE_ICON: Record<Route, IconName> = {
  playground: "chat",
  arena: "swords",
  leaderboard: "trophy",
  pricing: "tag",
  history: "history",
  endpoints: "plug",
};

const SIDEBAR_KEY = "sandroid.sidebar";
const isMac =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform);

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function PageFallback() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton h-10 w-10 rounded-2xl" />
        <div className="space-y-2">
          <div className="skeleton h-5 w-48" />
          <div className="skeleton h-3 w-72" />
        </div>
      </div>
      <div className="skeleton h-40 w-full rounded-2xl" />
      <div className="skeleton h-24 w-full rounded-2xl" />
    </div>
  );
}

export default function App() {
  const t = useT();
  const route = useRoute();
  const { lang, setLang } = useLang();
  const endpointCount = useCredentials((s) => s.endpoints.length);
  const busy: Partial<Record<Route, boolean>> = {
    playground: usePlayground((s) => s.running),
    arena: useArena((s) => s.running || s.checking || !!s.queue),
  };
  const anyBusy = Object.values(busy).some(Boolean);
  const Page = PAGES[route];
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* per-viewer nicety only */
      }
      return !c;
    });
  const toggleLang = () => setLang(lang === "en" ? "id" : "en");

  // Keep document title / meta in sync with the active hash route.
  useSeo(route, lang);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // braces matter: newer browsers return a Promise from scrollTo, and an effect must not return one
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  const commands = useMemo<Command[]>(
    () => [
      ...ROUTES.map((r) => ({
        id: `go-${r}`,
        label: t(`nav.${r}`),
        hint: t("palette.goTo"),
        icon: ROUTE_ICON[r],
        run: () => (window.location.hash = href(r)),
      })),
      {
        id: "new-chat",
        label: t("playground.newChat"),
        hint: t("nav.playground"),
        icon: "plus",
        run: () => {
          if (!usePlayground.getState().running)
            usePlayground.getState().newChat();
          window.location.hash = href("playground");
        },
      },
      {
        id: "new-battle",
        label: t("arena.newBattle"),
        hint: t("nav.arena"),
        icon: "refresh",
        run: () => {
          const a = useArena.getState();
          if (!a.running && !a.checking && !a.queue) a.newBattle();
          window.location.hash = href("arena");
        },
      },
      {
        id: "lang",
        label: t("palette.language"),
        hint: lang === "en" ? "→ Indonesia" : "→ English",
        icon: "globe",
        run: toggleLang,
        keywords: "bahasa language",
      },
      {
        id: "sidebar",
        label: t("palette.sidebar"),
        icon: "sidebar",
        run: toggleSidebar,
        keywords: "menu",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow `lang`; actions read fresh state
    [lang],
  );

  const navItem = (r: Route, mobile = false) => {
    const active = route === r;
    return (
      <a
        key={r}
        href={href(r)}
        aria-current={active ? "page" : undefined}
        title={collapsed && !mobile ? t(`nav.${r}`) : undefined}
        className={`group relative flex items-center gap-3 rounded-xl text-sm whitespace-nowrap transition-all duration-200 ${
          mobile
            ? "shrink-0 px-3 py-1.5"
            : `py-2 ${collapsed ? "justify-center px-0" : "px-3"}`
        } ${active ? "bg-gradient-to-r from-sky-500/15 to-sky-500/5 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"}`}
      >
        {!mobile && (
          <span
            aria-hidden
            className={`absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sky-400 shadow-[0_0_10px_var(--color-sky-400)] transition-all duration-300 ${active ? "opacity-100" : "scale-y-0 opacity-0"}`}
          />
        )}
        <span className="relative">
          <Icon
            name={ROUTE_ICON[r]}
            size={mobile ? 15 : 18}
            className={`transition-transform duration-200 group-hover:scale-110 ${active ? "text-sky-300" : ""}`}
          />
          {busy[r] && (
            <span
              className="absolute -top-1 -right-1 flex h-2 w-2"
              aria-label="running"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
            </span>
          )}
        </span>
        {(mobile || !collapsed) && (
          <span className="flex-1">{t(`nav.${r}`)}</span>
        )}
        {r === "endpoints" && endpointCount > 0 && (mobile || !collapsed) && (
          <span className="rounded-full bg-sky-500/15 px-1.5 text-[11px] font-medium text-sky-300">
            {endpointCount}
          </span>
        )}
      </a>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* run indicator */}
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-300 ${anyBusy ? "opacity-100" : "opacity-0"}`}
      >
        <div className="h-full w-full origin-left animate-progress bg-gradient-to-r from-transparent via-sky-400 to-transparent" />
      </div>

      {/* desktop sidebar */}
      <aside
        className={`glass sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:flex ${collapsed ? "w-[4.5rem]" : "w-60"}`}
      >
        <div
          className={`flex h-16 items-center gap-2.5 ${collapsed ? "justify-center px-2" : "px-4"}`}
        >
          <a
            href={href("playground")}
            className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
          >
            <img
              src="/favicon.svg"
              alt=""
              className="h-9 w-9 shrink-0 rounded-[22%] drop-shadow-[0_0_12px_rgb(56_189_248/0.45)]"
            />
            {!collapsed && (
              <span className="truncate leading-tight">
                Sandroid
                <span className="block text-xs font-medium text-sky-400">
                  Play & Battle
                </span>
              </span>
            )}
          </a>
        </div>

        <div className={collapsed ? "px-2" : "px-3"}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title={t("palette.title")}
            className={`flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 text-xs text-slate-500 transition hover:border-slate-700 hover:text-slate-300 ${collapsed ? "h-9 justify-center" : "px-3 py-2"}`}
          >
            <Icon name="search" size={14} />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{t("palette.short")}</span>
                <span className="kbd">{isMac ? "⌘" : "Ctrl"}</span>
                <span className="kbd">K</span>
              </>
            )}
          </button>
        </div>

        <nav
          className={`mt-4 flex flex-1 flex-col gap-1 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}
        >
          {!collapsed && (
            <p className="px-3 pb-1 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">
              {t("nav.section")}
            </p>
          )}
          {ROUTES.map((r) => navItem(r))}
        </nav>

        <div
          className={`space-y-2 border-t border-slate-800/80 py-3 ${collapsed ? "px-2" : "px-3"}`}
        >
          {!collapsed && (
            <p className="flex items-start gap-2 rounded-xl bg-sky-950/30 px-3 py-2 text-[11px] leading-snug text-sky-200/70">
              <Icon
                name="lock"
                size={13}
                className="mt-px shrink-0 text-sky-400"
              />
              {t("banner.credentials")}
            </p>
          )}
          <div
            className={`flex items-center gap-1 ${collapsed ? "flex-col" : ""}`}
          >
            <button
              type="button"
              className="icon-btn"
              onClick={toggleSidebar}
              title={t("palette.sidebar")}
              aria-label={t("palette.sidebar")}
            >
              <Icon name="sidebar" />
            </button>
            <button
              type="button"
              className={`btn-ghost px-2 py-1 text-xs ${collapsed ? "" : "ml-auto"}`}
              onClick={toggleLang}
              aria-label="Language"
              title="Language"
            >
              <Icon name="globe" size={14} />
              {lang.toUpperCase()}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile header */}
        <header className="glass sticky top-0 z-30 border-b lg:hidden">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <a
              href={href("playground")}
              className="flex items-center gap-2 font-semibold tracking-tight"
            >
              <img
                src="/favicon.svg"
                alt=""
                className="h-8 w-8 rounded-[22%]"
              />
              <span>
                Sandroid <span className="text-sky-400">Play & Battle</span>
              </span>
            </a>
            <span className="flex-1" />
            <span className="text-sky-400" title={t("banner.credentials")}>
              <Icon name="lock" size={15} />
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("palette.title")}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={toggleLang}
              aria-label="Language"
            >
              {lang.toUpperCase()}
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
            {ROUTES.map((r) => navItem(r, true))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <ErrorBoundary resetKey={route}>
            <Suspense fallback={<PageFallback />}>
              <div key={route} className="animate-fade-up">
                <Page />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-slate-600 lg:px-8">
          MIT · {t("app.tagline")} ·{" "}
          <a
            className="inline-flex items-center gap-1 hover:text-slate-400"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            API <Icon name="external" size={11} />
          </a>
        </footer>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
}
