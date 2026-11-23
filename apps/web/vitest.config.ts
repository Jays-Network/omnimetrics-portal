import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
    // Unit and mocked tests only: no live DB, no network.
    testTimeout: 60_000, // the 48-panel fit test and the builder import are heavy under parallel load
    restoreMocks: true,
    clearMocks: true,
  },
});
