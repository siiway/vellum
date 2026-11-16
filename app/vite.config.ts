import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { bundledPackagesPlugin } from "./scripts/vite-packages";

export default defineConfig({
  plugins: [react(), bundledPackagesPlugin()],
  resolve: {
    alias: {
      "@web": resolve(__dirname, "src/web"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // .vite/manifest.json, read by the page build and not deployed.
    manifest: true,
    rollupOptions: {
      input: resolve(__dirname, "src/web/hydrate.tsx"),
      output: {
        entryFileNames: "assets/vellum.[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
        // Split React + the FluentUI icon set into stable vendor chunks so
        // they cache independently of app code. We deliberately *don't* split
        // @fluentui/react-components — doing so defeats tree-shaking and the
        // lazy() loads in reactComponents.ts (the bundler would pre-eagerly
        // include every FluentUI component into one giant chunk).
        manualChunks(id) {
          if (id.includes("node_modules/@fluentui/react-icons")) return "fluentui-icons";
          if (
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler/")
          )
            return "react";
        },
      },
    },
    target: "es2022",
    cssCodeSplit: false,
  },
  // The build code (src/build) is type-checked alongside; Vite ignores non-input files.
  appType: "custom",
});
