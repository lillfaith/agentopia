import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { ThemeManifest } from "./types";

const ThemeCtx = createContext<ThemeManifest | null>(null);

export function ThemeProvider({ theme, children }: { theme: ThemeManifest; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.ui.cssVars)) root.style.setProperty(k, v);
    root.dataset.theme = theme.id;
    let link: HTMLLinkElement | null = null;
    if (theme.ui.fontStylesheet) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = theme.ui.fontStylesheet;
      document.head.appendChild(link);
    }
    return () => {
      for (const k of Object.keys(theme.ui.cssVars)) root.style.removeProperty(k);
      link?.remove();
    };
  }, [theme]);
  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeManifest {
  const t = useContext(ThemeCtx);
  if (!t) throw new Error("useTheme outside ThemeProvider");
  return t;
}
