import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { bundledPackagesPlugin } from "./scripts/vite-packages";
import { enginePlugin } from "./scripts/vite-engine";
import { bindingExportsPlugin } from "./scripts/vite-exports";

export default defineConfig({
  plugins: [react(), bundledPackagesPlugin(), enginePlugin(), bindingExportsPlugin()],
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
        // Split React into a stable vendor chunk so it caches independently
        // of app code. We deliberately *don't* split FluentUI: a manual chunk
        // takes the modules it imports too, and every page would load the
        // ones only the lazy() loads in reactComponents.ts or the engine
        // (scripts/vite-engine.ts) use.
        manualChunks(id) {
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
