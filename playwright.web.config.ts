import { defineConfig, devices } from '@playwright/test';

const e2ePort = 1422;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

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
    baseURL: e2eBaseUrl,
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
    // 1421 is reserved for the Tauri development server's HMR websocket.
    command: `npx vite --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseUrl,
    env: {
      ODDEYES_DISABLE_HMR: '1',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
