import { expect, test } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

const sourceText = 'The workspace is designed for enterprise administrators.';
const targetText = '이 작업 공간은 엔터프라이즈 관리자를 위해 설계되었습니다.';

test.describe('Alignment inspection view', () => {
  test.beforeEach(async ({ page }) => {
    const now = Date.now();
    await injectTauriMockWithProject(page, {
      id: 'alignment-project',
      metadata: {
        title: 'Alignment Project',
        domain: 'technical',
        targetLanguage: 'Korean',
        createdAt: now,
        updatedAt: now,
        settings: {
          strictnessLevel: 0.5,
          autoSave: true,
          autoSaveInterval: 5000,
          theme: 'system',
        },
      },
      segments: [{
        groupId: 'segment-1',
        sourceIds: ['source-block'],
        targetIds: ['target-block'],
        isAligned: true,
        order: 0,
      }],
      blocks: {
        'source-block': {
          id: 'source-block',
          type: 'source',
          content: `<p data-translation-unit-id="unit-1">${sourceText}</p>`,
          hash: '',
          metadata: { createdAt: now, updatedAt: now, tags: [] },
        },
        'target-block': {
          id: 'target-block',
          type: 'target',
          content: `<p data-translation-unit-id="unit-1">${targetText}</p>`,
          hash: '',
          metadata: { createdAt: now, updatedAt: now, tags: [] },
        },
      },
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('문서 보기가 기본 모드다', async ({ page }) => {
    await expect(page.getByTestId('editor-view-mode-document')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('alignment-view')).toHaveCount(0);
  });

  test('정렬 검사로 전환해도 에디터 인스턴스는 살아 있다', async ({ page }) => {
    const targetEditor = page.locator("[data-testid='target-editor'] [contenteditable='true']");
    await expect(targetEditor).toContainText(targetText);

    await page.getByTestId('editor-view-mode-alignment').click();

    await expect(page.getByTestId('alignment-view')).toBeVisible();
    // 언마운트 금지 — DOM에는 남아 있고 visibility로만 가려진다.
    // (언마운트하면 editorStore가 비어 점프·검수 적용이 깨진다)
    await expect(targetEditor).toHaveCount(1);
    await expect(targetEditor).not.toBeVisible();

    await page.getByTestId('editor-view-mode-document').click();

    await expect(page.getByTestId('alignment-view')).toHaveCount(0);
    await expect(targetEditor).toBeVisible();
    await expect(targetEditor).toContainText(targetText);
  });

  test('짝이 맞는 문단은 한 행에 나란히 보이고, 클릭하면 활성 행이 된다', async ({ page }) => {
    await page.getByTestId('editor-view-mode-alignment').click();

    const row = page.getByTestId('alignment-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(sourceText);
    await expect(row).toContainText(targetText);
    await expect(row).toContainText('1:1');
    await expect(row).toHaveAttribute('data-active', 'false');

    await row.click();
    await expect(row).toHaveAttribute('data-active', 'true');
  });
});
