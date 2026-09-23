import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.GATEWAY_URL || "http://127.0.0.1:3001",
        ws: true,
      },
    },
  },
  preview: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.GATEWAY_URL || "http://gateway:3001",
        ws: true,
      },
    },
  },
});
