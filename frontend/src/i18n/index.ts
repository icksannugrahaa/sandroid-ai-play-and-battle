/**
 * Tiny i18n (ID/EN) — replaces i18next to keep the bundle light.
 * `t("a.b", { n: 2 })` looks up a flat key and fills `{n}`. EN is the fallback.
 */
import { create } from "zustand";

import en from "./en.json";
import id from "./id.json";

export type Lang = "en" | "id";
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en, id };
const KEY = "sandroid.lang";

function detect(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(KEY);
  if (saved === "en" || saved === "id") return saved;
  return navigator.language?.toLowerCase().startsWith("id") ? "id" : "en";
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>()((set) => ({
  lang: detect(),
  setLang: (lang) => {
    window.localStorage.setItem(KEY, lang);
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLang((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}
