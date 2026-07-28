import { test, expect } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

test.describe('Project Picker - New Project', () => {
  test('opens new form and creates project via New -> Create', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'Existing Project' } as never,
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 프로젝트 목록은 좌측 사이드바가 아니라 툴바 드롭다운에 있다.
    await page.getByTestId('project-picker-trigger').click();
    await expect(page.getByTestId('project-new-button')).toBeVisible();
    await page.getByTestId('project-new-button').click();

    const titleInput = page.getByTestId('project-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('E2E Test Project');

    await page.getByTestId('project-create-button').click();

    // 생성 후 드롭다운은 닫히고, 트리거가 새 프로젝트 이름을 보여준다.
    await expect(titleInput).toBeHidden();
    await expect(page.getByTestId('project-picker-trigger')).toContainText('E2E Test Project');
  });
});
