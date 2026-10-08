import type { ThemeManifest } from "./types";

const themes = new Map<string, ThemeManifest>();

/** Register a theme pack. Future downloadable packs call this from their entry module. */
export function registerTheme(theme: ThemeManifest): void {
  themes.set(theme.id, theme);
}

export function listThemes(): ThemeManifest[] {
  return [...themes.values()];
}

export function getTheme(id: string | undefined): ThemeManifest {
  const theme = (id && themes.get(id)) || themes.values().next().value;
  if (!theme) throw new Error("No themes registered");
  return theme;
}
