import { expect, test, type Locator, type Page } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

const sourceText = 'The workspace is designed for enterprise administrators.';
const targetText = '이 작업 공간은 엔터프라이즈 관리자를 위해 설계되었습니다.';

async function selectAndOpenMenu(
  page: Page,
  editor: Locator,
  menuTestId: string,
): Promise<void> {
  await editor.selectText();
  await editor.dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 240,
    clientY: 240,
    button: 2,
  });
  await expect(page.getByTestId(menuTestId)).toBeVisible();
}

test.describe('Selection editing and scoped context', () => {
  test.beforeEach(async ({ page }) => {
    const now = Date.now();
    await injectTauriMockWithProject(page, {
      id: 'selection-project',
      metadata: {
        title: 'Selection Editing Project',
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

  test('Source selection becomes metadata and never exposes retranslate', async ({ page }) => {
    const sourceEditor = page.locator(
      "[data-testid='source-editor'] [contenteditable='true']",
    );
    await selectAndOpenMenu(page, sourceEditor, 'selection-action-menu-source');

    await expect(page.getByTestId('selection-action-retranslate')).toHaveCount(0);
    await page.getByTestId('selection-action-add-chat').click();

    const chip = page.getByTestId('selection-context-chip');
    await expect(chip).toContainText('Source');
    await expect(chip).toContainText(sourceText);
    await expect(
      page.locator("[data-testid='chat-composer-container'] [contenteditable='true']"),
    ).not.toContainText(sourceText);
  });

  test('Target selection opens a scoped preview with only global constraints on', async ({ page }) => {
    const targetEditor = page.locator(
      "[data-testid='target-editor'] [contenteditable='true']",
    );
    await selectAndOpenMenu(page, targetEditor, 'selection-action-menu-target');

    await expect(page.getByTestId('selection-action-retranslate')).toBeVisible();
    await page.getByTestId('selection-action-retranslate').click();

    await expect(page.getByTestId('selection-edit-modal')).toBeVisible();
    await expect(page.getByTestId('selection-edit-modal')).toContainText(sourceText);
    await expect(page.getByTestId('selection-edit-modal')).toContainText(targetText);
    // 번역 규칙·금칙어는 모든 문장에 적용되는 전역 제약이라 부분 수정에도 기본 on이다.
    for (const option of ['translationRules', 'forbiddenTerms']) {
      await expect(page.getByTestId(`selection-reference-${option}`)).toBeChecked();
    }
    for (const option of ['glossary', 'projectContext']) {
      await expect(page.getByTestId(`selection-reference-${option}`)).not.toBeChecked();
    }
  });

  test('Target retranslate generates via mock AI, applies, and clears the highlight', async ({ page }) => {
    const targetEditor = page.locator(
      "[data-testid='target-editor'] [contenteditable='true']",
    );
    await selectAndOpenMenu(page, targetEditor, 'selection-action-menu-target');
    await page.getByTestId('selection-action-retranslate').click();

    const modal = page.getByTestId('selection-edit-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('.selection-anchor')).toHaveCount(1);

    // 1st click: generate (mock AI echoes marker-wrapped body)
    await page.getByTestId('selection-edit-primary-button').click();
    await expect(modal).toContainText('Mock AI 응답입니다.');

    // 2nd click: apply replaces only the anchored range and removes the anchor
    await page.getByTestId('selection-edit-primary-button').click();
    await expect(modal).toHaveCount(0);
    await expect(targetEditor).toContainText('Mock AI 응답입니다.');
    await expect(page.locator('.selection-anchor')).toHaveCount(0);
  });

  test('dismissing the chat selection chip removes the highlight', async ({ page }) => {
    const targetEditor = page.locator(
      "[data-testid='target-editor'] [contenteditable='true']",
    );
    await selectAndOpenMenu(page, targetEditor, 'selection-action-menu-target');
    await page.getByTestId('selection-action-add-chat').click();

    const chip = page.getByTestId('selection-context-chip');
    await expect(chip).toBeVisible();
    await expect(page.locator('.selection-anchor')).toHaveCount(1);

    await chip.getByRole('button').last().click();
    await expect(page.getByTestId('selection-context-chip')).toHaveCount(0);
    await expect(page.locator('.selection-anchor')).toHaveCount(0);
  });

  test('approved project memory is managed separately from the legacy context field', async ({ page }) => {
    await page.getByTestId('toolbar-menu-settings').click();
    await expect(page.getByTestId('project-memory-settings')).toBeVisible();

    await page.getByTestId('project-memory-new-item').fill('Audience: enterprise administrators');
    await page.getByTestId('project-memory-add').click();

    await expect(page.getByTestId('project-memory-settings')).toContainText(
      'Audience: enterprise administrators',
    );
    // 보관이 아니라 하드 삭제 하나로 통일됐다.
    await expect(page.getByTestId('project-memory-delete')).toBeVisible();
  });
});
