import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // web3.js и anchor местами обращаются к `global` (как в Node)
  define: { global: "globalThis" },
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1000 }, // web3.js + anchor весят ~630 КБ, это нормально
});
