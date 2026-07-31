import { expect, test } from '@playwright/test';
import { injectTauriMock } from './tauri-mock';
import { mockProject } from './fixtures/mock-data';

const SOURCE_ID = 'memory-source-project';
const TARGET_ID = 'memory-target-project';

test.describe('Project memory import', () => {
  test.beforeEach(async ({ page }) => {
    const source = mockProject({
      id: SOURCE_ID,
      metadata: { ...mockProject().metadata, title: 'Season 34 Patch Notes' },
    });
    const target = mockProject({
      id: TARGET_ID,
      metadata: { ...mockProject().metadata, title: 'Season 35 Patch Notes' },
    });
    // 최근 프로젝트 목록은 삽입 순서를 따르므로 대상이 먼저 열리도록 앞에 둔다.
    await injectTauriMock(page, { seedProjects: [target, source] });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 원본 프로젝트의 메모리는 커맨드로 직접 심는다. UI로 프로젝트를 오가며
    // 채우면 검증 대상(가져오기)이 아니라 프로젝트 전환을 시험하게 된다.
    await page.evaluate(async (sourceId) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      await invoke('add_project_memory_item', {
        args: {
          projectId: sourceId,
          category: 'audience',
          content: 'Korean PC and console players',
          status: 'active',
          source: 'chat',
        },
      });
      await invoke('add_project_memory_item', {
        args: {
          projectId: sourceId,
          category: 'domain',
          content: 'Battle royale shooter patch notes',
          status: 'active',
          source: 'chat',
        },
      });
      await invoke('upsert_forbidden_term', {
        args: {
          projectId: sourceId,
          id: null,
          term: 'battlegrounds',
          replacement: 'PUBG',
          note: null,
          enabled: true,
        },
      });
    }, SOURCE_ID);
  });

  test('copies selected memory from another project and skips duplicates', async ({ page }) => {
    await page.getByTestId('toolbar-menu-settings').click();
    await expect(page.getByTestId('project-memory-settings')).toBeVisible();

    // 대상에 원본과 같은 내용을 미리 넣어 중복 건너뛰기를 검증한다.
    await page.getByTestId('project-memory-new-item').fill('Korean PC and console players');
    await page.getByTestId('project-memory-add').click();
    await expect(page.getByTestId('project-memory-settings')).toContainText(
      'Korean PC and console players',
    );

    await page.getByTestId('project-memory-import-open').click();
    const modal = page.getByTestId('project-memory-import-modal');
    await expect(modal).toBeVisible();

    await page.getByTestId('project-memory-import-source').selectOption(SOURCE_ID);
    await expect(modal).toContainText('Battle royale shooter patch notes');

    await page.getByTestId('project-memory-import-submit').click();
    await expect(modal).toBeHidden();

    const settings = page.getByTestId('project-memory-settings');
    await expect(settings).toContainText('Battle royale shooter patch notes');
    await expect(page.getByTestId('forbidden-terms-settings')).toContainText('battlegrounds');
    // 중복된 항목은 한 번만 남는다. 직접 넣은 1건 + 가져온 1건 = 2행.
    await expect(page.getByTestId('project-memory-item')).toHaveCount(2);
    const settingsText = await settings.innerText();
    expect(settingsText.split('Korean PC and console players').length - 1).toBe(1);
  });

  test('does not offer the active project as an import source', async ({ page }) => {
    await page.getByTestId('toolbar-menu-settings').click();
    await page.getByTestId('project-memory-import-open').click();

    const options = page.getByTestId('project-memory-import-source').locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toHaveAttribute('value', SOURCE_ID);
  });
});
