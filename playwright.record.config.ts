import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Demo recording config.
 *
 * Usage:
 *   npx playwright test -c playwright.record.config.ts --headed
 *
 * Output: remotion-demo/public/recordings/*.webm
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['record-demos.spec.ts', 'record-ai.spec.ts'],

  // Sequential — stable recording, no resource contention
  workers: 1,
  fullyParallel: false,

  retries: 0,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:1421',
    viewport: { width: 1920, height: 1080 },
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    // No traces/screenshots needed for recording
    trace: 'off',
    screenshot: 'off',
    // Realistic interaction speed
    actionTimeout: 10000,
  },

  outputDir: path.resolve(__dirname, 'test-results/recordings'),

  projects: [
    {
      name: 'recording',
      use: {
        browserName: 'chromium',
        // Disable headless explicitly (--headed flag also works)
        headless: false,
        launchOptions: {
          args: ['--window-size=1920,1080'],
        },
      },
    },
  ],

  webServer: {
    command: 'npx vite --port 1421',
    url: 'http://localhost:1421',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
