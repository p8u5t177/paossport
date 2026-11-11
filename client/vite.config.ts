import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3848,
    proxy: {
      "/api": { target: "http://127.0.0.1:3847", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3847", changeOrigin: true },
    },
  },
});
