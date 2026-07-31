/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // .tsx as well as .ts: the chart components are asserted by rendering them
  // to static markup, which needs JSX in the test file. Without this the
  // render tests are silently never collected.
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
})
