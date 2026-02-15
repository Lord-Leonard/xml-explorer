import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/xmlExplorer/index.ts", import.meta.url)),
      name: "XMLExplorer",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
    rollupOptions: {
      external: ["react", "react-dom", "@monaco-editor/react", "monaco-editor"],
    },
  },
});
