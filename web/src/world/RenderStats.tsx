import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Exposes renderer counters on `window.__agentopiaStats` once a second when the
 * page is opened with `?stats`, for performance checks (draw calls, triangles, fps).
 */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("stats")) return;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      frames++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const id = setInterval(() => {
      const r = gl.info.render;
      (window as unknown as { __agentopiaStats: unknown }).__agentopiaStats = {
        calls: r.calls,
        triangles: r.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        fps: frames,
        dpr: gl.getPixelRatio(),
      };
      frames = 0;
    }, 1000);
    return () => {
      clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [gl]);
  return null;
}
