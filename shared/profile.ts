import type { Agent, InstructionProfile } from "./types.js";

/**
 * An employee's instructions as one AGENTS.md-style document, and back.
 *
 *   # <Job title>
 *   ## Role                      ← system prompt / role definition
 *   ## Personality
 *   ## Responsibilities          ← "- " bullets
 *   ## Operating instructions
 *   ## Task-specific instructions
 *   ## Reference notes
 *
 * Parsing never drops text: anything under an unknown heading is kept in Operating
 * instructions with its heading, so a hand-edited file round-trips without losing content.
 */

export const PROFILE_FIELDS = ["role", "personality", "systemPrompt", "responsibilities", "operatingInstructions", "taskInstructions", "referenceNotes"] as const;

export const PROFILE_LIMITS = {
  role: 60,
  personality: 1000,
  systemPrompt: 20000,
  responsibility: 200,
  responsibilities: 20,
  operatingInstructions: 20000,
  taskInstructions: 20000,
  referenceNotes: 20000,
} as const;

const SECTIONS: { key: Exclude<keyof InstructionProfile, "role">; heading: string; aliases: string[] }[] = [
  { key: "systemPrompt", heading: "Role", aliases: ["role", "system prompt", "role definition", "who you are"] },
  { key: "personality", heading: "Personality", aliases: ["personality", "tone of voice", "voice"] },
  { key: "responsibilities", heading: "Responsibilities", aliases: ["responsibilities", "duties"] },
  { key: "operatingInstructions", heading: "Operating instructions", aliases: ["operating instructions", "how you work", "rules", "operating rules"] },
  { key: "taskInstructions", heading: "Task-specific instructions", aliases: ["task-specific instructions", "task instructions", "playbooks"] },
  { key: "referenceNotes", heading: "Reference notes", aliases: ["reference notes", "memory", "memory references", "things to remember", "knowledge"] },
];

export function profileOf(a: Pick<Agent, "role" | "personality" | "systemPrompt" | "responsibilities"> & Partial<Pick<Agent, "operatingInstructions" | "taskInstructions" | "referenceNotes">>): InstructionProfile {
  return {
    role: a.role,
    personality: a.personality,
    systemPrompt: a.systemPrompt,
    responsibilities: a.responsibilities,
    operatingInstructions: a.operatingInstructions ?? "",
    taskInstructions: a.taskInstructions ?? "",
    referenceNotes: a.referenceNotes ?? "",
  };
}

export function profileToMarkdown(p: InstructionProfile): string {
  const out = [`# ${p.role.trim() || "Employee"}`, ""];
  for (const s of SECTIONS) {
    const value = s.key === "responsibilities" ? p.responsibilities.map((r) => `- ${r}`).join("\n") : p[s.key].trim();
    out.push(`## ${s.heading}`, "", value, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function markdownToProfile(md: string, fallbackRole = ""): InstructionProfile {
  const profile: InstructionProfile = { role: fallbackRole, personality: "", systemPrompt: "", responsibilities: [], operatingInstructions: "", taskInstructions: "", referenceNotes: "" };
  const text: Record<string, string[]> = {};
  const extra: string[] = [];
  let current: string | null = null; // section key, "extra:<heading>", or null (before the first ##)
  const preamble: string[] = [];
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (h1 && current === null) {
      profile.role = h1[1].trim();
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (h2) {
      const name = h2[1].trim();
      const known = SECTIONS.find((s) => s.aliases.includes(name.toLowerCase()));
      if (known) current = known.key;
      else {
        current = "extra";
        extra.push(`### ${name}`);
      }
      continue;
    }
    if (current === null) preamble.push(line);
    else if (current === "extra") extra.push(line);
    else (text[current] ??= []).push(line);
  }
  const body = (k: string) => (text[k] ?? []).join("\n").trim();
  profile.systemPrompt = [preamble.join("\n").trim(), body("systemPrompt")].filter(Boolean).join("\n\n");
  profile.personality = body("personality");
  profile.responsibilities = (text.responsibilities ?? [])
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  profile.operatingInstructions = [body("operatingInstructions"), extra.join("\n").trim()].filter(Boolean).join("\n\n");
  profile.taskInstructions = body("taskInstructions");
  profile.referenceNotes = body("referenceNotes");
  return profile;
}

/** Problems that would make a profile unsavable (mirrors the server's limits). */
export function profileProblems(p: InstructionProfile): string[] {
  const out: string[] = [];
  if (!p.role.trim()) out.push("Give the job a title (the # heading).");
  if (p.role.length > PROFILE_LIMITS.role) out.push(`Job title is over ${PROFILE_LIMITS.role} characters.`);
  if (!p.systemPrompt.trim()) out.push("The Role section can't be empty.");
  if (p.responsibilities.length > PROFILE_LIMITS.responsibilities) out.push(`Keep it to ${PROFILE_LIMITS.responsibilities} responsibilities.`);
  if (p.responsibilities.some((r) => r.length > PROFILE_LIMITS.responsibility)) out.push(`Each responsibility must be under ${PROFILE_LIMITS.responsibility} characters.`);
  for (const k of ["personality", "systemPrompt", "operatingInstructions", "taskInstructions", "referenceNotes"] as const) {
    if (p[k].length > PROFILE_LIMITS[k]) out.push(`${k} is too long.`);
  }
  return out;
}

export function sameProfile(a: InstructionProfile, b: InstructionProfile): boolean {
  return PROFILE_FIELDS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
