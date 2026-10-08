import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.PORT ?? 8787);

// `vite build --mode demo` makes a fully static build that replays a recorded
// simulation in the browser (no server, no AI): deployable to Netlify or any static host.
export default defineConfig(({ mode }) => ({
  root: "web",
  plugins: [react()],
  base: mode === "demo" ? "./" : "/",
  define: { "import.meta.env.VITE_DEMO": JSON.stringify(mode === "demo" ? "1" : "") },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: mode === "demo" ? "../dist/demo" : "../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
}));
