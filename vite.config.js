import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "dashboard",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../dist/dashboard",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
});
