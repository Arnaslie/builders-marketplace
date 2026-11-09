import { defineConfig } from "vitest/config";

// tsconfig keeps "jsx": "preserve" for Next; tests need JSX compiled, so tell esbuild here.
export default defineConfig({ esbuild: { jsx: "automatic" } });
