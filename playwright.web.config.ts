import { defineConfig, devices } from '@playwright/test';

// Web harness only.
// Default E2E gate for this project is Tauri smoke (`npm run test:e2e`).
export default defineConfig({
  testDir: './e2e',
  testIgnore: 'record-demos.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:1421',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx vite --port 1421',
    url: 'http://localhost:1421',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
