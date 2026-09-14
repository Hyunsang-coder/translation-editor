import { expect, test } from '@playwright/test';
import { injectTauriMock } from './tauri-mock';
import { mockProject } from './fixtures/mock-data';

const TITLES = ['Season 35 Patch Notes', 'Season 34 Patch Notes', 'Onboarding Guide'];

test.describe('Project Picker - Search', () => {
  test.beforeEach(async ({ page }) => {
    const seeds = TITLES.map((title, i) => mockProject({
      id: `search-project-${i}`,
      metadata: { ...mockProject().metadata, title },
    }));
    // 시작 시 프로젝트 ID 목록의 첫 항목을 열고, 목(mock)은 삽입 순서를 따르므로 첫 시드가 열린다.
    await injectTauriMock(page, { seedProjects: seeds });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('project-picker-trigger')).toContainText(TITLES[0]);
  });

  test('filters projects by title and switches to a match', async ({ page }) => {
    await page.getByTestId('project-picker-trigger').click();
    const menu = page.getByTestId('project-picker-menu');
    const rows = menu.locator('[data-project-row]');
    const search = page.getByTestId('project-search-input');

    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(3);

    await search.fill('patch');
    await expect(rows).toHaveCount(2);

    await search.fill('ONBOARD');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Onboarding Guide');

    await rows.first().locator('[data-project-select]').click();
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('project-picker-trigger')).toContainText('Onboarding Guide');
  });

  test('shows an empty state and resets the query on reopen', async ({ page }) => {
    await page.getByTestId('project-picker-trigger').click();
    const menu = page.getByTestId('project-picker-menu');
    const search = page.getByTestId('project-search-input');

    await search.fill('no such project');
    await expect(menu.locator('[data-project-row]')).toHaveCount(0);
    await expect(page.getByTestId('project-search-empty')).toHaveText(
      /^(일치하는 프로젝트가 없습니다\.|No matching projects\.)$/,
    );

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await page.getByTestId('project-picker-trigger').click();
    await expect(page.getByTestId('project-search-input')).toHaveValue('');
    await expect(menu.locator('[data-project-row]')).toHaveCount(3);
  });
});
