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
    buildNav: (occupiedSlots) => ({ nodes, edges, hangouts }), // walk graph for the plots in use;
                                                        // hangouts = decorative idle destinations
    buildingStyles: [{ kind: "workshop", label: "Workshop", icon: "⚙️", description: "…" }, …],
    lightingKeyframes: [{ hour: 6.1, preset }, …],      // interpolated continuously; sun position is computed
    camera: { fov, overviewPosition, overviewTarget, minDistance, maxDistance, minPolar, maxPolar },
    walkSpeed: 2.6,
    labelHeight: 2.7,
    renderer: { toneMapping: "neutral", exposure: 1, fog: [95, 240] }, // optional look settings
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

## How Pastel Village is built (a template for packs)

**Art direction:** a pink fantasy town. Pink is carried by a family of hues (blush, rose, sakura,
mauve, lavender, peach, cream) so objects stay separable; mint, baby blue and butter are sparing
accents. Value contrast comes from deep rose timber, plum ironwork and plum text against creams.

The default theme is organised so its pieces can ship separately later (environment, buildings,
characters, wearables):

| File | Role |
|---|---|
| `palette.ts` | Every colour in the theme: base swatches (`PALETTE`), semantic roles for the world (`TOKENS`: ground, stone, foliage, flowers, wood, roofs, walls, glow…) and the UI CSS variables (`UI_VARS`, AA-contrast notes inline). A colourway variant only needs a new palette file |
| `layout.ts` | Pure data: plots, island outline, landmarks (pier, hyacinth field, picnic), winding paths that steer around every plot, the walk graph, lighting keyframes |
| `composition.ts` | Pure placement of scenery by focal priority: plaza first, then buildings, villagers, and a few grouped groves (two tree shapes) framing the island. Everything yields to plots and paths. Unit-tested, including a "calm" budget |
| `architecture.ts` | Building kit (walls, half-timbering, tiled roofs, windows with shutters and flower boxes, doors, lanterns, fenced yards). Parts are merged into one mesh per material |
| `Buildings.tsx` | One model per building kind plus a cottage for unknown kinds; animated details (dome, gears, quill, smoke) stay separate |
| `terrain.tsx`, `plaza.tsx`, `flora.tsx`, `shore.tsx` | Rendering of the island and pearly sea, the square and board-game paths, trees, and the pier and picnic, mostly instanced |
| `textures.ts` | Procedural canvas textures (no image files) |
| `Character.tsx`, `wearables.tsx` | Villager rig and the core cosmetic pack |

**Custom departments.** A building on any plot gets a fenced yard, a painted sign with its name and a
path that bends around other plots. Buildings whose slot the theme doesn't know (for example, created
under another theme) get spare plots that never overlap designed ones (`FALLBACK_SPOTS`).

**Performance budget.** The full town with every plot built is about 600 draw calls and 500k triangles
including the shadow pass. Repeated scenery is instanced, buildings are merged per material, only two
real point lights exist (lamps use additive light pools), and `PerformanceMonitor` lowers the pixel
ratio on slower GPUs. Open the app with `?stats` to read live counters from `window.__agentopiaStats`,
and `?cam=x,y,z,tx,ty,tz` to open on a fixed viewpoint.

## Phase 3 (planned)

Downloadable packs: a packaged ES module + manifest + assets (GLTF models, audio), signature
verification, and a loader that registers packs at runtime. The current contract is designed so
built-in themes and future packs use the same interface.
