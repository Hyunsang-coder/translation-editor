import { test, expect } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

test.describe('Project Sidebar - New Project', () => {
  test('opens new form and creates project via New -> Create', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'Existing Project' } as never,
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('project-new-button')).toBeVisible();
    await page.getByTestId('project-new-button').click();

    const titleInput = page.getByTestId('project-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('E2E Test Project');

    await page.getByTestId('project-create-button').click();

    await expect(titleInput).toBeHidden();
    await expect(page.locator('[title="E2E Test Project"]').first()).toBeVisible();
  });
});
