# Building a theme pack

Agentopia separates **what the town does** (agents, tasks, tools, data, all on the server) from
**how it looks and sounds** (a theme, in the browser). A theme can replace the terrain, buildings,
characters, animations, lighting, weather, UI colours, icons and sound effects. Agents, tasks,
integrations and saved data stay exactly as they are.

The contract is `web/src/theme-engine/types.ts` (`ThemeManifest`). The reference implementation is
`web/src/themes/pastel-village/`.

## What a theme receives

Themes only get **theme-agnostic, read-only** inputs. They never see prompts, task contents, keys or the API.

| Input | Source | Example |
|---|---|---|
| `building.kind` | server `buildings.kind` | `"hq"`, `"research"`, `"studio"`, `"workshop"`, `"atelier"`, `"lab"`; anything else → draw a fallback |
| `building.slot` | server `buildings.slot` | `"north"`; the theme maps slots to world positions |
| `appearance` | agent cosmetics (`shared/cosmetics.ts`) | colours, eyes, expression, ears, tail, size and wearables per slot (`head · eyes · neck · back · hand`). Unknown item ids need a sensible fallback |
| `anim` | real status, or decorative idle flavour | real: `think · work · sit-work · read · write · carry · wait · celebrate · confused`; decorative (idle only): `idle · walk · rest · sleep · converse`. See `WORK_ANIMS` |
| `talking` | voice system | mouth flaps while the villager speaks |
| `moving`, `carrying` | world controller | walking a real hand-off → `carrying = true` |
| `env` | day cycle (`web/src/environment/dayCycle.ts`) | real local hour in the town timezone (or the visual override), phase, interpolated lighting, weather placeholder |
| `glow` | interpolated lighting | 0 by day, 1 at night: light windows and lamps |
| `activity` | agents working in a building | animate chimneys, telescopes, … |

## What a theme provides

```ts
export const myTheme: ThemeManifest = {
  id: "my-theme", name: "My Theme", version: "1.0.0", author: "You", description: "…",
  ui: {
    cssVars: { "--accent": "#…", "--panel": "…", "--font": "…", /* see pastel-village/index.ts */ },
    fontStylesheet: "https://…",            // optional
    icons: { tasks: "📋", approvals: "🔔", day: "☀️", /* … */ },
  },
  world: {
    slots: { north: {...}, west: {...}, east: {...} }, // position, rotation, door, idleSpots
    slotLabels: { north: "North plaza", … },           // shown when users build departments
    fallbackSlot: (i) => ({...}),                       // for buildings in unknown slots
    buildNav: (occupiedSlots) => ({ nodes, edges }),    // walk graph for the plots in use
    buildingStyles: [{ kind: "workshop", label: "Workshop", icon: "⚙️", description: "…" }, …],
    lightingKeyframes: [{ hour: 6.1, preset }, …],      // interpolated continuously; sun position is computed
    camera: { fov, overviewPosition, overviewTarget, minDistance, maxDistance, minPolar, maxPolar },
    walkSpeed: 2.6,
    labelHeight: 2.7,
  },
  components: { Environment, Building, Character, Weather /* optional */ },
  audio: { playSfx: (id, audioContext) => {…}, ambientUrl: null },
};
```

Register it in `web/src/themes/index.ts`:

```ts
registerTheme(myTheme);
```

It then appears in **Settings → Theme**. The choice is saved server-side in `settings.themeId`.

## Rules for theme authors

1. **Original assets only.** Don't ship copyrighted characters or artwork.
2. **Never fake activity.** Animate from the props you receive; don't invent progress.
3. **Handle unknowns.** Users create their own departments, so new building kinds, slots and cosmetic
   item ids (from future packs) will appear. Draw a tasteful fallback, and offer enough plots (the pastel theme has 11 plus a spiral fallback).
4. **Keep it light.** Use instancing for repeated decoration; avoid more than a handful of real-time lights.
5. **Accessibility.** UI CSS variables must keep text readable (WCAG AA contrast on panels).

## Phase 3 (planned)

Downloadable packs: a packaged ES module + manifest + assets (GLTF models, audio), signature
verification, and a loader that registers packs at runtime. The current contract is designed so
built-in themes and future packs use the same interface.
