import { expect, test, type Page } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

const sourceText = 'The workspace is designed for enterprise administrators.';
const targetText = '이 작업 공간은 엔터프라이즈 관리자를 위해 설계되었습니다.';

/** 원문/번역문 HTML을 가진 프로젝트 하나로 앱을 띄운다. */
async function seed(page: Page, source: string, target: string): Promise<void> {
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
        content: source,
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
      'target-block': {
        id: 'target-block',
        type: 'target',
        content: target,
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
    },
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

test.describe('Alignment inspection view', () => {
  test.beforeEach(async ({ page }) => {
    await seed(
      page,
      `<p data-translation-unit-id="unit-1">${sourceText}</p>`,
      `<p data-translation-unit-id="unit-1">${targetText}</p>`,
    );
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

test.describe('Alignment mismatch band', () => {
  // 번역문에만 있는 문단 하나 — 원문 2 : 번역문 3
  test.beforeEach(async ({ page }) => {
    await seed(
      page,
      '<p data-translation-unit-id="s1">First paragraph.</p><p data-translation-unit-id="s2">Second paragraph.</p>',
      '<p data-translation-unit-id="t1">첫 번째 문단.</p><p data-translation-unit-id="t2">원문에 없는 문단.</p><p data-translation-unit-id="t3">두 번째 문단.</p>',
    );
  });

  test('짝이 없는 문단은 배너와 빈 셀로 드러낸다', async ({ page }) => {
    await page.getByTestId('editor-view-mode-alignment').click();

    const band = page.getByTestId('alignment-mismatch-band');
    await expect(band).toHaveCount(1);
    await expect(band).toContainText('번역문에 문단이 1개 더 있습니다');
    await expect(band).toContainText('원문 2 : 번역문 3');
    await expect(band).toContainText('짝을 추정하지 않고');

    const mismatchRow = page.locator("[data-testid='alignment-row'][data-kind='target-only']");
    await expect(mismatchRow).toHaveCount(1);
    await expect(mismatchRow).toContainText('대응하는 원문 없음');
    await expect(mismatchRow).toContainText('0:1');

    // 불일치 행은 선택 대상이 아니다 — 잘못된 짝을 고르게 두지 않는다
    await mismatchRow.click();
    await expect(mismatchRow).toHaveAttribute('data-active', 'false');
  });

  test('하단 요약과 정렬 리포트가 실제 수치를 담는다', async ({ page }) => {
    await page.getByTestId('editor-view-mode-alignment').click();

    const summary = page.getByTestId('alignment-view');
    await expect(summary).toContainText('문단 3개');
    await expect(summary).toContainText('2개 정렬');
    await expect(summary).toContainText('1개 불일치');
    await expect(page.getByTestId('alignment-degraded')).toHaveCount(0);

    await page.getByTestId('alignment-export-report').click();

    const written = await page.evaluate(
      () => (window as unknown as { __MOCK_WRITTEN_FILES__?: { content: string }[] }).__MOCK_WRITTEN_FILES__ ?? []
    );
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!.content)).toMatchObject({
      kind: 'alignment_check',
      project_id: 'alignment-project',
      total_units: 3,
      paired: 2,
      mismatched: 1,
      unmapped_issues: 0,
      degraded: false,
    });
  });

  test('배너의 열기 버튼은 문서 보기로 되돌린다', async ({ page }) => {
    await page.getByTestId('editor-view-mode-alignment').click();
    await page.getByTestId('alignment-band-open').click();

    await expect(page.getByTestId('alignment-view')).toHaveCount(0);
    await expect(page.getByTestId('editor-view-mode-document')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Alignment jump to document', () => {
  test.beforeEach(async ({ page }) => {
    await seed(
      page,
      '<p data-translation-unit-id="s1">First paragraph.</p><p data-translation-unit-id="s2">Second paragraph.</p>',
      '<p data-translation-unit-id="t1">첫 번째 문단.</p><p data-translation-unit-id="t2">두 번째 문단.</p>',
    );
  });

  test('활성 행의 편집 버튼이 문서 보기의 해당 문단으로 커서를 옮긴다', async ({ page }) => {
    await page.getByTestId('editor-view-mode-alignment').click();

    const secondRow = page.getByTestId('alignment-row').nth(1);
    await secondRow.click();

    const editButton = secondRow.getByTestId('alignment-row-edit');
    await expect(editButton).toBeVisible();
    await editButton.click();

    await expect(page.getByTestId('alignment-view')).toHaveCount(0);

    // 커서가 두 번째 문단 안에 있다 (scrollIntoView 없이 setTextSelection + focus)
    const caretText = await page.evaluate(() => {
      const selection = document.getSelection();
      const node = selection?.anchorNode ?? null;
      return node ? (node.textContent ?? '') : '';
    });
    expect(caretText).toContain('두 번째 문단');
  });
});
