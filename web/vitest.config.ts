import { defineConfig } from 'vitest/config';

// Unit tests for pure library logic (no React / no Next runtime). The GenUI
// fence + card parsers (lib/genui/*) run on every stream and every history
// reload, so they get permanent coverage here. Node environment is enough —
// these modules have no DOM or `@/` alias dependencies.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
