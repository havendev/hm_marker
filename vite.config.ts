import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, "src/dashboard/index.html"),
      },
    },
  },
});
