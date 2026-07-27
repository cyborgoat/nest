import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/admin/",
  build: {
    outDir: resolve(__dirname, "../hub/public/admin"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          tanstack: [
            "@tanstack/react-query",
            "@tanstack/react-router",
            "@tanstack/react-table",
          ],
          radix: ["@radix-ui/react-dialog", "@radix-ui/react-select"],
        },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
