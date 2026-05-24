import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// @cloudflare/vite-plugin runs the Worker code alongside the Vite dev server,
// exposing D1 / R2 / etc. bindings via Miniflare locally. One `npm run dev`
// gives you the React frontend + the Worker API on a single origin.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
