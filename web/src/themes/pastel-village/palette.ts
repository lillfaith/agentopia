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
    /** Soft, desaturated sage: alive, but never fighting the pinks. */
    grass: "#bcd4ae",
    yard: "#c7dcb9",
    patchDark: "#86b97c",
    patchLight: "#f1efd8",
    /** Petal carpets and clover that tint the meadow pink. */
    patchBlush: "#f7c3d4",
    sand: "#fbe4d8",
    sandMid: "#f8dccd",
    sandWet: "#e8c2b4",
    cliff: ["#a8d394", "#93c385", "#f0c4bc", "#f4d2c9", "#e5afac", "#d5979f"],
    /** Pearly pink-blue sea: pastel aqua with a blush sheen, fading to cotton-candy shallows. */
    water: "#94cfe0",
    waterSheen: "#f3c6dc",
    shallows: ["#ffd6e5", "#f0d2ea", "#bfe6ee"],
  },
  /** Board-game path: smooth tiles on a blush base. */
  path: { base: "#f3dde3", tiles: ["#fbeaee", "#f8dbe3", "#fdf3f3"], ring: ["#f6c9d6", "#fbe3ea", "#f2bccd"], edge: "#e8bfcc" },
  /** Plaza rings, centre outwards. */
  plaza: { rings: ["#fdf3f2", "#f8d6e0", "#fbe9ec", "#e9dcf5", "#fbe9ec", "#f5c6d4"], gap: "#ecd0da" },
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
    greens: ["#a8c89c", "#b4cfa5", "#a0c3a2"],
    pines: ["#7cc6a2", "#8ad0ab", "#6fb996"],
    /** Sakura family: the signature trees. */
    blossoms: ["#f8c4d5", "#f3b3c9", "#fad0dd"],
    roundPink: ["#f5b8cf", "#e8bde8", "#ffcabb"],
    poplars: ["#a6d79a", "#c9b4ea"],
    hedge: "#a7c99f",
    hedgeBlooms: [P.sakura, P.pastelRose, "#ffffff", P.lavender],
    bushes: ["#a9c99e", "#b6d1a8"],
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
    hyacinths: ["#f4a6c8", "#fbe3ef", "#dcc4f2", "#f7b6cf"],
    /** The plaza bed: blush, rose and white only. */
    bed: [P.sakura, "#f39ab6", "#ffffff", P.blush],
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

/**
 * UI tokens (CSS variables). Every panel, button and badge in the interface reads
 * these, so another theme restyles the whole UI by supplying its own values.
 * Contrast (WCAG): text #70455F is 7.1:1 on the panel colour #FFF1F7; muted
 * #7B4767 is 6.4:1; on-accent #4A1C3A is 5.6:1 on the #FF82B6 accent.
 */
export const UI_VARS: Record<string, string> = {
  "--font": "'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  "--bg": "#fde9f1",
  // Frosted panels: a clearly pink tint that still lets the town show through.
  "--panel": "rgba(255, 224, 238, 0.9)",
  "--panel-tint": "linear-gradient(160deg, rgba(255, 214, 233, 0.92), rgba(255, 228, 240, 0.9) 45%, rgba(255, 219, 236, 0.91))",
  "--panel-blur": "blur(16px) saturate(1.35)",
  // Cards, inputs and tiles inside panels.
  "--panel-solid": "#fff1f7",
  "--panel-border": "#f9d7e7",
  // Outer frame of floating panels (a touch deeper so they separate from the world).
  "--panel-edge": "#f2b9d3",
  "--chip": "#fff1f7",
  "--chip-hover": "#ffe2ef",
  "--text": "#70455f",
  "--muted": "#7b4767",
  "--accent": "#ff82b6",
  "--accent-gradient": "linear-gradient(135deg, #ff9cc6, #ff82b6 55%, #f877ad)",
  "--on-accent": "#4a1c3a",
  "--accent-strong": "#962a5f", // headings, links and selected tabs: 6.9:1 on #FFF1F7, 4.8:1 on the frosted panel over dark scenery
  "--accent-soft": "#ffd3e6",
  "--accent-2": P.deepLilac,
  "--good": "#2f9e78",
  "--good-soft": "#e3f6ec",
  "--warn": "#d98a14",
  "--warn-soft": "#fff1d6",
  "--warn-edge": "#ffd98a",
  "--warn-text": "#7d5100",
  "--bad": "#d9435f",
  "--bad-soft": "#ffe1e8",
  "--bad-edge": "#ffb3c1",
  "--bad-text": "#952140",
  "--info": "#4a8fd4",
  "--radius": "18px",
  "--shadow": "0 10px 30px rgba(214, 92, 150, 0.2), 0 2px 6px rgba(170, 80, 130, 0.14)",
};
