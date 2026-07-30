import { expect, test, type Locator, type Page } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

const sourceText = 'The workspace is designed for enterprise administrators.';
const targetText = '이 작업 공간은 엔터프라이즈 관리자를 위해 설계되었습니다.';

// 선택 액션의 진입점은 인라인 툴바 하나다(우클릭 메뉴는 중복이라 제거됨).
async function selectAndOpenToolbar(
  page: Page,
  editor: Locator,
  toolbarTestId: string,
): Promise<void> {
  await editor.click();
  await editor.selectText();
  await expect(page.getByTestId(toolbarTestId)).toBeVisible();
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

  test('Selecting target text shows the inline toolbar without right-clicking', async ({ page }) => {
    const targetEditor = page.locator(
      "[data-testid='target-editor'] [contenteditable='true']",
    );
    await targetEditor.click();
    await targetEditor.selectText();

    // 150ms 디바운스 후 선택 영역 위에 뜬다.
    await expect(page.getByTestId('selection-inline-toolbar-target')).toBeVisible();
    for (const action of ['retranslate', 'add-chat', 'comment', 'copy']) {
      await expect(page.getByTestId(`selection-inline-${action}`)).toBeVisible();
    }
  });

  test('Source inline toolbar never exposes retranslate', async ({ page }) => {
    const sourceEditor = page.locator(
      "[data-testid='source-editor'] [contenteditable='true']",
    );
    await sourceEditor.click();
    await sourceEditor.selectText();

    await expect(page.getByTestId('selection-inline-toolbar-source')).toBeVisible();
    await expect(page.getByTestId('selection-inline-retranslate')).toHaveCount(0);
    await expect(page.getByTestId('selection-inline-add-chat')).toBeVisible();
  });

  test('오른쪽 끝에서 선택해도 인라인 툴바는 한 줄로 화면 안에 들어온다', async ({ page }) => {
    const targetEditor = page.locator(
      "[data-testid='target-editor'] [contenteditable='true']",
    );
    await targetEditor.click();
    // 문단 끝(패널 오른쪽 가장자리)을 선택해 툴바를 화면 밖으로 밀어본다.
    await page.keyboard.press('End');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+ArrowLeft');
    }

    const toolbar = page.getByTestId('selection-inline-toolbar-target');
    await expect(toolbar).toBeVisible();
    const box = await toolbar.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('toolbar box를 측정할 수 없습니다.');

    // 폭이 좁아지면 라벨이 줄바꿈되고, 버튼 높이는 34px로 고정이라 넘친 줄이
    // overflow-hidden에 잘린다(= 화면상 정렬이 무너진 상태).
    const overflow = await toolbar.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  });

  test('Source selection becomes metadata and never exposes retranslate', async ({ page }) => {
    const sourceEditor = page.locator(
      "[data-testid='source-editor'] [contenteditable='true']",
    );
    await selectAndOpenToolbar(page, sourceEditor, 'selection-inline-toolbar-source');

    await expect(page.getByTestId('selection-inline-retranslate')).toHaveCount(0);
    await page.getByTestId('selection-inline-add-chat').click();

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
    await selectAndOpenToolbar(page, targetEditor, 'selection-inline-toolbar-target');

    await expect(page.getByTestId('selection-inline-retranslate')).toBeVisible();
    await page.getByTestId('selection-inline-retranslate').click();

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
    await selectAndOpenToolbar(page, targetEditor, 'selection-inline-toolbar-target');
    await page.getByTestId('selection-inline-retranslate').click();

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
    await selectAndOpenToolbar(page, targetEditor, 'selection-inline-toolbar-target');
    await page.getByTestId('selection-inline-add-chat').click();

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
