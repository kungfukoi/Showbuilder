import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3334",
      "/uploads": "http://127.0.0.1:3334",
      "/outputs": "http://127.0.0.1:3334",
      "/masks": "http://127.0.0.1:3334"
    }
  }
});
