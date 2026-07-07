import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const uiDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: uiDir,
  plugins: [vue()],
  resolve: {
    alias: {
      vue: "vue/dist/vue.esm-bundler.js",
    },
  },
  build: {
    outDir: resolve(uiDir, "..", "public"),
    emptyOutDir: true,
  },
  server: {
    port: 18190,
    proxy: {
      "/api": "http://127.0.0.1:18080",
    },
  },
});
