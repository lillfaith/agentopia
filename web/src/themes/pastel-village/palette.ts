/**
 * Pastel Village palette: one place for every colour in the theme.
 *
 * Art direction: a pink fantasy town. Pink is the identity, carried by a family
 * of related hues (blush, rose, sakura, mauve, lavender, peach and cream) rather
 * than one flat pink, so objects stay separable. Mint, baby blue and butter
 * yellow are accents used sparingly. Value contrast comes from deeper roses,
 * mauves and plum (timber, iron, text) against creams and blushes.
 *
 * Modules ask for a ROLE (e.g. `TOKENS.wood.timber`), never a raw hex, so a
 * palette variant (or another theme pack) can restyle the town from here.
 */

/** Base swatches. */
export const PALETTE = {
  // pinks (light → deep)
  cream: "#fff7f3",
  shell: "#fdeef0",
  blush: "#f9d3dd",
  sakura: "#ffbcd2",
  pastelRose: "#f6a6bf",
  rose: "#ec88a8",
  deepRose: "#cf5a86",
  mauve: "#c497b4",
  dustyMauve: "#a87597",
  plum: "#6e4a6c",
  inkPlum: "#4f3352",
  // cool pinks
  lavender: "#dccbf3",
  lilac: "#c3aaeb",
  deepLilac: "#9d84d6",
  // warm pinks
  peach: "#ffd2bd",
  apricot: "#f8b79c",
  // accents (sparingly)
  mint: "#a9e3c9",
  babyBlue: "#b7dcf5",
  butter: "#fff0a8",
  gold: "#f6cf74",
} as const;

const P = PALETTE;

/** Semantic roles used by the 3D world. */
export const TOKENS = {
  ground: {
    /** Spring green warmed toward pink so it harmonises with blossoms. */
    grass: "#b4d6a6",
    yard: "#bddcab",
    patchDark: "#86b97c",
    patchLight: "#f1efd8",
    /** Petal carpets and clover that tint the meadow pink. */
    patchBlush: "#f7c3d4",
    sand: "#fbe4d8",
    sandMid: "#f8dccd",
    sandWet: "#e8c2b4",
    cliff: ["#a8d394", "#93c385", "#f0c4bc", "#f4d2c9", "#e5afac", "#d5979f"],
    water: "#8fd0ea",
    shallows: ["#d9f4f2", "#c6eef0", "#bde6ee"],
  },
  stone: {
    flag: ["#fdf2f1", "#f8e7ea", "#fef6f4", "#f4e2e7", "#fbecef"],
    flagRose: ["#f4c9d6", "#efbccc"],
    flagLavender: ["#e6d9f4", "#ddcdf0"],
    cobble: ["#f2dde2", "#e9cfd8", "#f6e6e7", "#e8d2de", "#efd8d2", "#e3ccd9"],
    cobbleEdge: ["#dfb7c6", "#d7aec0"],
    mortar: "#ddc4cf",
    curb: "#ecc9d4",
    curbTop: "#f7e1e8",
    medallion: "#fbf0f2",
    medallionRing: P.mauve,
    medallionStar: P.lavender,
    medallionStarInner: P.sakura,
    foundation: "#efdfe3",
    doorFrame: "#f5e8ea",
    step: "#eedde2",
    rocks: ["#efd9e0", "#e3d7ef", "#f3e0d8"],
  },
  foliage: {
    greens: ["#9fd28f", "#b2dc93", "#8fcc9f", "#bfe39a"],
    pines: ["#7cc6a2", "#8ad0ab", "#6fb996"],
    /** Sakura family: the signature trees. */
    blossoms: ["#ffc4d8", "#f7aac6", "#ffd3e2", "#f2b2d0", "#e9c4f2", "#ffd6cc"],
    roundPink: ["#f5b8cf", "#e8bde8", "#ffcabb"],
    poplars: ["#a6d79a", "#c9b4ea"],
    hedge: "#97d2a0",
    hedgeBlooms: [P.sakura, P.pastelRose, "#ffffff", P.lavender],
    bushes: ["#9cd59a", "#b4dfa0"],
    flowering: ["#f4a9c6", "#f7bdd2", "#e6b8ee"],
    leaf: "#7fc489",
    trunk: "#b48475",
    trunkBlossom: "#a77a78",
  },
  flowers: {
    sets: [
      [P.sakura, P.pastelRose, "#ffffff"],
      [P.lavender, P.blush, P.lilac],
      [P.rose, P.peach, P.sakura],
      [P.blush, "#ffffff", P.babyBlue],
      [P.pastelRose, P.butter, P.blush],
    ],
    hyacinths: ["#f4a6c8", "#e98bb8", "#d8b4f0", "#fbe3ef", "#c7aef0", "#ffc2d8", "#f7b2d0"],
    mushrooms: [P.rose, P.pastelRose, P.lilac, P.apricot],
  },
  wood: {
    /** Pink-stained timber framing: the deep value that outlines every cottage. */
    timber: "#c97a98",
    fence: "#fff4f6",
    fenceRail: "#f3d6e0",
    bench: "#f0aac0",
    deck: ["#efc9c4", "#e8bdb9", "#f3d4cd"],
    post: "#d79da9",
    furniture: "#e5b1a0",
    crate: "#e7b8a3",
    planter: "#e8b8c6",
  },
  iron: "#8b6789",
  roofs: {
    hall: "#b8a0ec",
    hallTowers: "#a990e6",
    studio: "#ef8fab",
    workshop: "#c98fb2",
    dome: "#c9b2ef",
    domeRibs: P.gold,
    lab: "#c9b6ff",
  },
  walls: {
    hall: "#ffe3ec",
    hallStone: "#f6ebee",
    towers: "#fff3f2",
    studio: "#fff0e6",
    observatoryStone: "#f1e6ea",
    observatory: "#ece2f8",
    workshopBrick: "#f7d4d9",
    chimney: "#efbfc9",
  },
  trim: "#fffafc",
  shutters: { hall: P.lilac, studio: P.pastelRose, workshop: P.butter, observatory: P.mint },
  doors: { hall: P.deepRose, studio: P.rose, observatory: P.mauve, workshop: P.mauve, atelier: P.pastelRose, lab: P.deepLilac },
  signs: { hq: "#eadcff", research: "#f1e6fb", studio: "#ffe3ec", workshop: "#fde3e8", atelier: "#ffe3ef", lab: "#ece6ff", other: "#ffe8f0" },
  banner: P.rose,
  glow: {
    /** Window light: warm peach-pink rather than plain yellow. */
    window: "#ffb98f",
    lamp: "#ffc9a3",
    lampPool: "#ffb3c6",
    lampGlass: "#fff1ea",
    bulbs: ["#fff1e6", "#ffc4d8", "#ffe2b8", "#f1d6ff"],
    fountain: "#d6f0ff",
  },
  bunting: [P.sakura, P.butter, P.babyBlue, P.lilac, P.pastelRose],
  cloud: "#fff5f8",
  petals: [P.sakura, P.blush, "#ffffff"],
  fireflies: "#ffd6e6",
};

/** UI tokens (CSS variables). Text colours meet WCAG AA on the panel colours. */
export const UI_VARS: Record<string, string> = {
  "--font": "'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  "--bg": "#fde9f1",
  "--panel": "rgba(255, 248, 251, 0.9)",
  "--panel-solid": "#fffafc",
  "--panel-tint": "linear-gradient(160deg, rgba(255, 236, 244, 0.95), rgba(255, 250, 252, 0.92) 45%, rgba(246, 238, 255, 0.92))",
  "--panel-border": "rgba(232, 160, 192, 0.55)",
  "--text": P.inkPlum, // 10.6:1 on panel
  "--muted": "#7f5277", // 6.0:1 on panel, 5.1:1 on accent-soft
  "--accent": "#d94f88", // white bold text 4.2:1; used for large/bold labels
  "--accent-strong": "#b0306a", // links, headers and selected tabs: 5.8:1 on panel, 4.9:1 on accent-soft
  "--accent-2": P.deepLilac,
  "--accent-soft": "#ffe0ec",
  "--accent-gradient": "linear-gradient(135deg, #cc4a84, #a92c64)", // white bold text 4.3–6.3:1
  "--good": "#2f9e78",
  "--warn": "#d98a14",
  "--bad": "#d9435f",
  "--info": "#4a8fd4",
  "--chip": "rgba(255, 255, 255, 0.94)",
  "--radius": "18px",
  "--shadow": "0 10px 30px rgba(200, 90, 140, 0.18), 0 2px 6px rgba(160, 80, 130, 0.12)",
};
