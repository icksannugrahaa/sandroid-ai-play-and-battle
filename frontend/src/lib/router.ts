/** Minimal hash router (#/arena) — no router dependency. Hash routing also works behind any static host. */
import { useEffect, useState } from "react";

export const ROUTES = ["playground", "arena", "leaderboard", "pricing", "history", "endpoints"] as const;
export type Route = (typeof ROUTES)[number];

function current(): Route {
  const name = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as Route;
  return ROUTES.includes(name) ? name : "playground";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function href(route: Route): string {
  return `#/${route}`;
}
