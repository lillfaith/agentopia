import { z } from "zod";
import type { LocalTool, ToolContext, ToolOutcome } from "./tools.js";

/**
 * GitHub tools, run with the GitHub token the owner gave this villager (stored encrypted).
 * Reading is free to use; anything that writes to GitHub (issues, comments, pull requests)
 * waits for the owner's approval first, like every other outside action.
 */

/** Overridable in tests. */
export const githubApi = { base: "https://api.github.com", fetch: (...a: Parameters<typeof fetch>) => fetch(...a) };

const MAX_CHARS = 60_000;
const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use owner/name, e.g. octocat/hello-world");
const repoProp = { type: "string", description: "Repository as owner/name, e.g. octocat/hello-world." };

class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function token(ctx: ToolContext): string | ToolOutcome {
  if (!ctx.agent.githubCredentialId) return { content: "No GitHub token is set for you. The owner can add one in your Configure tab.", isError: true };
  const secret = ctx.store.credentialSecret(ctx.agent.githubCredentialId);
  if (!secret) return { content: "Your GitHub token can't be read. Ask the owner to add it again.", isError: true };
  return secret;
}

async function gh<T>(secret: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await githubApi.fetch(`${githubApi.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "agentopia",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const msg = (() => {
      try {
        return (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        return text;
      }
    })();
    throw new GitHubError(`GitHub ${res.status}: ${msg.slice(0, 300)}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Run a GitHub call with the villager's token, turning failures into a message the model can act on. */
async function withToken(ctx: ToolContext, fn: (secret: string) => Promise<string>): Promise<ToolOutcome> {
  const t = token(ctx);
  if (typeof t !== "string") return t;
  try {
    const out = await fn(t);
    return { content: out.length > MAX_CHARS ? `${out.slice(0, MAX_CHARS)}\n…(truncated)` : out };
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 0;
    const hint = status === 401 ? " The token was rejected; the owner may need to replace it." : status === 404 ? " Not found, or this token can't see it." : "";
    return { content: `${err instanceof Error ? err.message : String(err)}${hint}`, isError: true };
  }
}

const enc = encodeURIComponent;
const issueLine = (i: { number: number; title: string; state: string; user?: { login?: string }; pull_request?: unknown; html_url: string }) =>
  `#${i.number} ${i.pull_request ? "[PR] " : ""}${i.title} (${i.state}, by ${i.user?.login ?? "?"}) ${i.html_url}`;

// ── read ──

const listReposSchema = z.object({ query: z.string().max(200).optional() });
const listRepos: LocalTool<typeof listReposSchema> = {
  kind: "local",
  id: "github_list_repos",
  label: "List GitHub repositories",
  description: "List repositories the GitHub token can access, most recently updated first. Optionally filter by a search query.",
  sensitivity: "none",
  implementation: "real",
  schema: listReposSchema,
  inputSchema: () => ({ type: "object", properties: { query: { type: "string", description: "Optional words to match in the repository name." } }, additionalProperties: false }),
  summarize: (i) => (i.query ? `List repos matching “${i.query}”` : "List repos"),
  run: (input, ctx) =>
    withToken(ctx, async (t) => {
      const repos = await gh<{ full_name: string; private: boolean; description: string | null; updated_at: string }[]>(t, "GET", "/user/repos?per_page=100&sort=updated");
      const q = input.query?.toLowerCase();
      const list = repos.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 50);
      return list.length ? list.map((r) => `${r.full_name}${r.private ? " (private)" : ""}: ${r.description ?? ""}`).join("\n") : "No repositories found.";
    }),
};

const readFileSchema = z.object({ repo, path: z.string().max(500).regex(/^(?!.*\.\.)[^\0]*$/, "Invalid path").default(""), ref: z.string().max(200).optional() });
const readFile: LocalTool<typeof readFileSchema> = {
  kind: "local",
  id: "github_read_file",
  label: "Read a file from GitHub",
  description: "Read a file (or list a folder) in a repository. Use an empty path for the top-level folder.",
  sensitivity: "none",
  implementation: "real",
  schema: readFileSchema,
  inputSchema: () => ({
    type: "object",
    properties: { repo: repoProp, path: { type: "string", description: "File or folder path, e.g. src/index.ts. Empty for the root." }, ref: { type: "string", description: "Branch, tag or commit (optional)." } },
    required: ["repo"],
    additionalProperties: false,
  }),
  summarize: (i) => `Read ${i.repo}/${i.path}${i.ref ? `@${i.ref}` : ""}`,
  run: (input, ctx) =>
    withToken(ctx, async (t) => {
      const path = input.path.split("/").filter(Boolean).map(enc).join("/");
      const data = await gh<{ type?: string; content?: string; encoding?: string; size?: number } | { name: string; type: string; path: string }[]>(
        t,
        "GET",
        `/repos/${input.repo}/contents/${path}${input.ref ? `?ref=${enc(input.ref)}` : ""}`,
      );
      if (Array.isArray(data)) return data.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`).join("\n") || "(empty folder)";
      if (data.encoding === "base64" && data.content) return Buffer.from(data.content, "base64").toString("utf8");
      return `This is a ${data.type ?? "file"} of ${data.size ?? "?"} bytes that can't be shown as text.`;
    }),
};

const listIssuesSchema = z.object({ repo, state: z.enum(["open", "closed", "all"]).default("open"), kind: z.enum(["issues", "pulls", "both"]).default("both") });
const listIssues: LocalTool<typeof listIssuesSchema> = {
  kind: "local",
  id: "github_list_issues",
  label: "List issues and pull requests",
  description: "List issues and/or pull requests in a repository (30 most recent).",
  sensitivity: "none",
  implementation: "real",
  schema: listIssuesSchema,
  inputSchema: () => ({
    type: "object",
    properties: { repo: repoProp, state: { type: "string", enum: ["open", "closed", "all"] }, kind: { type: "string", enum: ["issues", "pulls", "both"] } },
    required: ["repo"],
    additionalProperties: false,
  }),
  summarize: (i) => `List ${i.state} ${i.kind === "both" ? "issues and PRs" : i.kind} in ${i.repo}`,
  run: (input, ctx) =>
    withToken(ctx, async (t) => {
      const items = await gh<Parameters<typeof issueLine>[0][]>(t, "GET", `/repos/${input.repo}/issues?state=${input.state}&per_page=30`);
      const list = items.filter((i) => (input.kind === "both" ? true : input.kind === "pulls" ? !!i.pull_request : !i.pull_request));
      return list.length ? list.map(issueLine).join("\n") : "Nothing found.";
    }),
};

const readIssueSchema = z.object({ repo, number: z.number().int().positive() });
const readIssue: LocalTool<typeof readIssueSchema> = {
  kind: "local",
  id: "github_read_issue",
  label: "Read an issue or pull request",
  description: "Read one issue or pull request with its comments (and, for a pull request, the changed files).",
  sensitivity: "none",
  implementation: "real",
  schema: readIssueSchema,
  inputSchema: () => ({ type: "object", properties: { repo: repoProp, number: { type: "integer" } }, required: ["repo", "number"], additionalProperties: false }),
  summarize: (i) => `Read ${i.repo}#${i.number}`,
  run: (input, ctx) =>
    withToken(ctx, async (t) => {
      const issue = await gh<Parameters<typeof issueLine>[0] & { body: string | null }>(t, "GET", `/repos/${input.repo}/issues/${input.number}`);
      const comments = await gh<{ user?: { login?: string }; body: string }[]>(t, "GET", `/repos/${input.repo}/issues/${input.number}/comments?per_page=30`);
      const parts = [issueLine(issue), "", issue.body ?? "(no description)"];
      if (issue.pull_request) {
        const files = await gh<{ filename: string; status: string; additions: number; deletions: number }[]>(t, "GET", `/repos/${input.repo}/pulls/${input.number}/files?per_page=100`);
        parts.push("", "Changed files:", ...files.map((f) => `- ${f.filename} (${f.status}, +${f.additions} −${f.deletions})`));
      }
      if (comments.length) parts.push("", "Comments:", ...comments.map((c) => `— ${c.user?.login ?? "?"}: ${c.body}`));
      return parts.join("\n");
    }),
};

// ── write (always approved by the owner first) ──

const createIssueSchema = z.object({ repo, title: z.string().trim().min(1).max(250), body: z.string().max(20_000).default("") });
const createIssue: LocalTool<typeof createIssueSchema> = {
  kind: "local",
  id: "github_create_issue",
  label: "Open a GitHub issue",
  description: "Open a new issue in a repository. The owner approves it before it is created.",
  sensitivity: "publish",
  implementation: "real",
  schema: createIssueSchema,
  inputSchema: () => ({
    type: "object",
    properties: { repo: repoProp, title: { type: "string" }, body: { type: "string", description: "Markdown description." } },
    required: ["repo", "title"],
    additionalProperties: false,
  }),
  summarize: (i) => `Open issue in ${i.repo}: “${i.title}”`,
  run: (input, ctx) =>
    ctx.simulated
      ? Promise.resolve({ content: `[Simulated] Would open “${input.title}” in ${input.repo}.` })
      : withToken(ctx, async (t) => {
          const issue = await gh<{ number: number; html_url: string }>(t, "POST", `/repos/${input.repo}/issues`, { title: input.title, body: input.body });
          return `Opened issue #${issue.number}: ${issue.html_url}`;
        }),
};

const commentSchema = z.object({ repo, number: z.number().int().positive(), body: z.string().trim().min(1).max(20_000) });
const comment: LocalTool<typeof commentSchema> = {
  kind: "local",
  id: "github_comment",
  label: "Comment on an issue or pull request",
  description: "Post a comment on an issue or pull request. The owner approves it before it is posted.",
  sensitivity: "publish",
  implementation: "real",
  schema: commentSchema,
  inputSchema: () => ({ type: "object", properties: { repo: repoProp, number: { type: "integer" }, body: { type: "string" } }, required: ["repo", "number", "body"], additionalProperties: false }),
  summarize: (i) => `Comment on ${i.repo}#${i.number}: “${i.body.slice(0, 80)}${i.body.length > 80 ? "…" : ""}”`,
  run: (input, ctx) =>
    ctx.simulated
      ? Promise.resolve({ content: `[Simulated] Would comment on ${input.repo}#${input.number}.` })
      : withToken(ctx, async (t) => {
          const c = await gh<{ html_url: string }>(t, "POST", `/repos/${input.repo}/issues/${input.number}/comments`, { body: input.body });
          return `Commented: ${c.html_url}`;
        }),
};

const prSchema = z.object({
  repo,
  title: z.string().trim().min(1).max(250),
  head: z.string().trim().min(1).max(200),
  base: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
});
const createPullRequest: LocalTool<typeof prSchema> = {
  kind: "local",
  id: "github_create_pull_request",
  label: "Open a pull request",
  description: "Open a pull request between two existing branches (head into base). The owner approves it before it is opened.",
  sensitivity: "publish",
  implementation: "real",
  schema: prSchema,
  inputSchema: () => ({
    type: "object",
    properties: {
      repo: repoProp,
      title: { type: "string" },
      head: { type: "string", description: "Branch with the changes." },
      base: { type: "string", description: "Branch to merge into, e.g. main." },
      body: { type: "string" },
    },
    required: ["repo", "title", "head", "base"],
    additionalProperties: false,
  }),
  summarize: (i) => `Open PR in ${i.repo}: ${i.head} → ${i.base}, “${i.title}”`,
  run: (input, ctx) =>
    ctx.simulated
      ? Promise.resolve({ content: `[Simulated] Would open a pull request ${input.head} → ${input.base} in ${input.repo}.` })
      : withToken(ctx, async (t) => {
          const pr = await gh<{ number: number; html_url: string }>(t, "POST", `/repos/${input.repo}/pulls`, { title: input.title, head: input.head, base: input.base, body: input.body });
          return `Opened pull request #${pr.number}: ${pr.html_url}`;
        }),
};

export const GITHUB_TOOLS = [listRepos, readFile, listIssues, readIssue, createIssue, comment, createPullRequest] as unknown as LocalTool[];
