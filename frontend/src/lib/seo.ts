/**
 * Runtime SEO for a hash-routed SPA.
 *
 * Crawlers index a single URL (the document root); the route lives in the hash
 * (`#/arena`), which is not sent to the server. To keep titles/descriptions
 * meaningful both for users (browser tab, history) and for JS-executing
 * crawlers, we update the document head on every route/language change.
 *
 * Keep this in sync with the static tags in `index.html` (those cover crawlers
 * that do not run JS and the initial share-preview scrape).
 */
import { useEffect } from "react";

import type { Lang } from "../i18n";
import { translate } from "../i18n";
import type { Route } from "./router";

const BASE_URL = "https://battle.sandroid.works/";
const SITE_NAME = "Sandroid AI Play & Battle";

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Update <title>, description, canonical, og/twitter tags for the active route. */
export function applySeo(route: Route, lang: Lang) {
  const t = (key: string) => translate(lang, key);
  const pageTitle = t(`seo.${route}.title`);
  const pageDesc = t(`seo.${route}.description`);
  // Root page keeps the site-level title; sub-routes prefix the page name.
  const title = route === "playground" ? `${SITE_NAME} — ${t("app.tagline")}` : `${pageTitle} · ${SITE_NAME}`;

  document.title = title;
  document.documentElement.lang = lang;

  setMeta('meta[name="description"]', "name", "description", pageDesc);
  setMeta('meta[property="og:title"]', "property", "og:title", title);
  setMeta('meta[property="og:description"]', "property", "og:description", pageDesc);
  setMeta('meta[property="og:url"]', "property", "og:url", BASE_URL);
  setMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
  setMeta('meta[property="og:locale"]', "property", "og:locale", lang === "id" ? "id_ID" : "en_US");
  setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
  setMeta('meta[name="twitter:description"]', "name", "twitter:description", pageDesc);
}

/** React hook: re-apply SEO whenever the route or language changes. */
export function useSeo(route: Route, lang: Lang) {
  useEffect(() => {
    applySeo(route, lang);
  }, [route, lang]);
}
