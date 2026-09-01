import { defineConfig } from 'vitest/config'

/** Run host tests in Node and browser component tests in jsdom. */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environmentMatchGlobs: [['tests/client-*.spec.tsx', 'jsdom']],
  },
})
