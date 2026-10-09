import type { CredentialService } from "./types.js";

/**
 * Order a provider's model list so a sensible default comes first: a current, affordable,
 * general model (e.g. the newest "gpt-N-mini" or "gemini-N-flash"), then current models
 * newest first, with dated snapshots, previews and legacy models at the end.
 * Provider lists are alphabetical, which would otherwise put e.g. gpt-3.5-turbo first.
 */
export function rankModels(service: CredentialService, ids: string[]): string[] {
  const preferred = recommendedModel(service, ids);
  const rest = ids.filter((id) => id !== preferred).sort((a, b) => sortKey(a) - sortKey(b) || version(b) - version(a) || a.localeCompare(b));
  return preferred ? [preferred, ...rest] : rest;
}

export function recommendedModel(service: CredentialService, ids: string[]): string | null {
  const current = ids.filter((id) => sortKey(id) === 0);
  const pick = (re: RegExp) =>
    current
      .filter((id) => re.test(id))
      .sort((a, b) => version(b) - version(a) || a.length - b.length)[0] ?? null;
  if (service === "openai") return pick(/^gpt-\d+(\.\d+)?o?-mini$/) ?? pick(/^gpt-\d+(\.\d+)?o?$/) ?? pick(/^gpt-/) ?? ids[0] ?? null;
  if (service === "gemini") return pick(/^gemini-\d+(\.\d+)?-flash$/) ?? pick(/^gemini-\d+(\.\d+)?-pro$/) ?? pick(/^gemini-/) ?? ids[0] ?? null;
  if (service === "anthropic") return pick(/^claude-sonnet-/) ?? pick(/^claude-/) ?? ids[0] ?? null;
  return ids[0] ?? null;
}

/** 0 = current alias, 1 = dated snapshot / preview / experimental, 2 = legacy generation. */
function sortKey(id: string): number {
  if (/^gpt-3\.5|^gpt-4(-\d|-turbo|-vision|$)|^gemini-1\.|^claude-(instant|2|3-)/i.test(id)) return 2;
  if (/-\d{4}-\d{2}-\d{2}$|-\d{8}$|-\d{4}$|-\d{3}$|preview|exp|latest/i.test(id)) return 1;
  return 0;
}

/** The model generation number in an id ("gpt-5.2-mini" → 5.2, "o4-mini" → 4, "claude-sonnet-5-5" → 5.5). */
function version(id: string): number {
  const m = id.match(/^(?:gpt-|gemini-|o)(\d+(?:\.\d+)?)/i) ?? id.match(/^claude-[a-z]+-(\d+)(?:-(\d))?(?:-|$)/i);
  if (!m) return 0;
  return m[2] !== undefined ? Number(`${m[1]}.${m[2]}`) : Number(m[1]);
}
