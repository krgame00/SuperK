import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/.next/**"],
  },
});
