import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: "::",
    port: 8080,
    allowedHosts: true,
  },
  build: {
    target: "esnext",
  },
});
