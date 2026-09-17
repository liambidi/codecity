import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Intention : `npm test` doit rester gratuit et instantane. Les tests qui
    // consomment l abonnement portent le suffixe .smoke et se lancent a part.
    exclude: ['**/node_modules/**', '**/*.smoke.test.ts'],
  },
})
