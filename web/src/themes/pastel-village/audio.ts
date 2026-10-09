import type { SfxId } from "../../theme-engine/types";

/** Tiny procedural sound palette (no audio files shipped): soft bells and pops. */
function tone(ctx: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

export function playPastelSfx(id: SfxId, ctx: AudioContext): void {
  switch (id) {
    case "click":
      tone(ctx, 880, 0, 0.08, "triangle", 0.05);
      break;
    case "open":
      tone(ctx, 660, 0, 0.1, "triangle", 0.05);
      tone(ctx, 990, 0.05, 0.12, "triangle", 0.04);
      break;
    case "start":
      tone(ctx, 523, 0, 0.15, "sine", 0.05);
      break;
    case "handoff":
      tone(ctx, 587, 0, 0.12, "triangle", 0.05);
      tone(ctx, 784, 0.08, 0.16, "triangle", 0.05);
      break;
    case "complete":
      [523, 659, 784, 1047].forEach((f, i) => tone(ctx, f, i * 0.08, 0.35, "sine", 0.06));
      break;
    case "approval":
      tone(ctx, 880, 0, 0.4, "sine", 0.07);
      tone(ctx, 1320, 0.12, 0.5, "sine", 0.05);
      break;
    case "fail":
      tone(ctx, 330, 0, 0.25, "sawtooth", 0.03);
      tone(ctx, 247, 0.15, 0.35, "sawtooth", 0.03);
      break;
  }
}
