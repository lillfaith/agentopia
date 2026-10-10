# Employees: hiring, instructions, equipment and templates

## Hiring in three steps

1. **Choose a job.** There are eight broad starting points: General Assistant, Researcher, Writer, Creator, Developer, Marketer, Analyst and Manager. You can also pick **Custom employee**, one of your saved templates, or a job from the searchable library. The library includes the original eight presets plus examples such as YouTube Manager, Store Manager, Stock Researcher and Email Assistant.
2. **Name & job.** Give the employee a name and a job title, and describe in plain words what it should do. Agentopia turns that description into a first draft of its instructions and equipment.
3. **Review & welcome.** The employee card shows the job, responsibilities and equipment.
   - These are folded away and optional: Appearance, Workplace, Model, connections & costs, and Permissions.
   - Click **Welcome to town** to hire.

Every setting stays editable afterwards on the employee's **Profile** tab, which has these sections: Job, Instructions, Equipment, Model, Permissions and Workplace.

## Instruction profile (AGENTS.md style)

Each employee has one instruction document:

| Section | Purpose |
|---|---|
| `# Job title` | e.g. "YouTube Manager" |
| `## Role` | The role definition / system prompt: who they are and what good work looks like |
| `## Personality` | Tone and manner |
| `## Responsibilities` | A bulleted list |
| `## Operating instructions` | How they work: formats, tone, always/never rules |
| `## Task-specific instructions` | Rules for particular kinds of jobs ("When writing a script: …") |
| `## Reference notes` | Facts to always keep in mind (brand, products, audience) |

You can edit the document section by section (**Simple**) or as one Markdown file (**AGENTS.md**). Switching views never drops text: content under an unknown heading is kept in Operating instructions.

**Versioning:**
- Every change to the instructions is stored as a new version in `agent_profile_versions`.
- **Version history** shows each version, and you can restore any of them. A restore adds a new version; the history is never rewritten.

**Nothing silently overwrites your instructions:**
- An edit carries the version it was based on. If the instructions changed in the meantime, the server answers 409 and your unsaved text stays on screen.
- AI drafts are only suggestions. During hiring, a draft fills the form only until you edit the instructions by hand; after that it appears as "Use the draft". On the Profile tab, **Rewrite from a description** shows a preview that you choose to apply, and nothing is saved until you press Save.
- Changes to the employee's status (working, idle) don't reset the form.

**Drafts: you choose how, and AI only runs when you ask:**
- **From the template and your words** is the default. It's free and makes no AI call.
- **✨ Write with AI** uses Agentopia's Claude on the cheapest model your plan allows, about $0.0003 a draft. The estimate and today's remaining allowance (`AGENTOPIA_DRAFTS_PER_DAY`, default 20) are shown before you choose it.
- **✨ Write with AI using your … key** uses any connected Claude, OpenAI or Gemini key. It's billed by that provider, not your plan.
- The same request is never paid for twice: identical drafts are reused for 24 hours at no charge.
- Every draft says who wrote it and what it cost. AI drafts appear in the Treasury as "🪄 Hiring desk (drafts)".
- See [COSTS.md](COSTS.md#hiring-desk-ai-written-instruction-drafts) for the full audit.

## What comes first

When the employee runs, the prompt is assembled in this order:
1. Your instruction profile.
2. Capability guidance.
3. **Agentopia's rules, last.** They state that the platform's rules take precedence over everything above.

Tools and approvals are not controlled by the prompt:
- An employee is offered only the tools from its equipped capabilities. That allowlist is enforced on the server.
- Before any tool runs, the server checks whether it needs approval:
  - A tool that publishes, sends, or creates something outside the town always waits for you.
  - On **Permissions**, you can make an employee's other on-server actions (e.g. Delegation, Remember) wait too. You can never turn approval off for a sensitive action.
  - Hosted tools (web search, code execution) run at the AI provider inside a single call, so they can't pause for approval. They are listed as automatic.

## Role, equipment, connections, permissions, model

| | What it is | Where |
|---|---|---|
| **Role** | What the employee is hired to do: job title, instructions, responsibilities | Profile → Job / Instructions |
| **Equipment** | Capabilities: Research, Writing, Coding, Memory, Delegation, GitHub, Publishing, Email, Images, 3D | Profile → Equipment (grid). Click a tile for its details, cost, requirements and approvals |
| **Connections** | Services: Agentopia's Claude, your Claude, OpenAI and Gemini keys, GitHub. Gmail, YouTube and Shopify are shown as coming soon | Settings → API keys; Profile → Model |
| **Permissions** | Which actions wait for approval | Profile → Permissions |
| **Model** | Which AI does the thinking, effort level, and price inputs for non-Claude models | Profile → Model |

Equipment status:
- **Ready:** works now.
- **Needs a connection:** e.g. GitHub without a token.
- **Coming soon:** Images and 3D. You can equip them now, and they start working when the integration ships.

## Templates

- **Templates are data, not code.** A profession is a title plus instructions plus a set of reusable capabilities. "YouTube Manager" therefore needs no profession-specific code.
- **Hiring copies the template.** Editing or deleting a template never changes an employee hired from it. `agents.template_id` only records where the employee started.
- **Built-in templates** live in `server/agents/templates.ts`, in two groups: `featured` (the eight broad ones) and `library` (specialized ones, searchable via `GET /api/templates?q=`).
- **Custom templates** live in the town database (`templates` table) with a version number that goes up on every edit. They're created by:
  - **⭐ Save as template** on an employee's profile, or the checkbox in the hire wizard.
  - `POST /api/templates`.
  - Import.

### Portable template files

```json
{
  "format": "agentopia.employee-template",
  "schemaVersion": 1,
  "exportedAt": "2026-10-10T12:00:00.000Z",
  "template": { "role": "YouTube Manager", "icon": "📺", "systemPrompt": "…", "responsibilities": ["…"], "skills": ["research", "writing", "memory"], "…": "…" }
}
```

- **Export:** `GET /api/templates/:id/export`. The file never contains keys, ids from your town, or buildings.
- **Import:** `POST /api/templates/import` validates the file.
  - Capabilities this server doesn't know are dropped and reported back.
  - Unknown fields are discarded.
  - Lengths are capped like any other edit.

This format is the basis for a future shared template library: search, versions and safe import are already in place.

## API summary

| Endpoint | |
|---|---|
| `GET /api/templates?q=` | Built-in + saved templates, optionally filtered |
| `POST /api/templates` · `PATCH/DELETE /api/templates/:id` | Saved templates (built-ins are read-only) |
| `GET /api/templates/:id/export` · `POST /api/templates/import` | Portable files |
| `POST /api/employee-drafts` | `{ description, role?, name?, templateId? }` → an editable draft. Nothing is saved |
| `POST /api/agents` | Hire. Optional: `operatingInstructions`, `taskInstructions`, `referenceNotes`, `approvalTools`, `templateId` |
| `PATCH /api/agents/:id` | Edit. Send `baseProfileVersion` with instruction changes |
| `GET /api/agents/:id/profile/versions` · `POST /api/agents/:id/profile/restore` | History and restore (`{ version, baseProfileVersion }`) |
| `POST /api/agents/:id/template` | Save an employee as a template |
