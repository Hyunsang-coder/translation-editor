import { test, expect, type Page } from '@playwright/test';
import { injectTauriMock, injectTauriMockWithProject } from './tauri-mock';

/**
 * E2E User Story: Maria의 번역 워크플로우
 *
 * Tauri mock layer를 주입하여 실제 React/TipTap/Zustand가 동작하되,
 * invoke() 호출만 mock 데이터를 반환합니다.
 */

const TEXT = {
  appSettings: /^(앱 설정|App Settings)$/,
  tools: /^(도구|Tools)$/,
  connect: /^(연결|Connect)$/,
  clear: /^(지우기|Clear)$/,
  close: /^(닫기|Close)$/,
  translate: /^(번역|Translate)$/,
  review: /^(검수|Review)$/,
  history: /^(히스토리|History)$/,
  aiChat: /^(AI 채팅|AI Chat)$/,
  save: /^(저장|Save)$/,
  rename: /^(이름 변경|Rename)$/,
  delete: /^(삭제|Delete)$/,
  webSearch: /^(웹 검색|Web Search)$/,
  confluenceSearch: /^(Confluence 검색|Confluence Search)$/,
  notionSearch: /^(Notion 검색|Notion Search)$/,
  targetLanguageWarning: /타겟 언어를 선택하세요|Select target language/i,
};

async function openAppSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: TEXT.appSettings }).click();
  await expect(page.getByRole('heading', { name: TEXT.appSettings })).toBeVisible();
}

async function openToolsMenu(page: Page): Promise<void> {
  await page.locator('button[title="도구"], button[title="Tools"]').click();
}

test.describe('User Story: Maria의 번역 워크플로우', () => {
  test('Phase 1: 초기 진입과 빈 프로젝트 상태', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: '새 프로젝트 시작하기' })).toBeVisible();
    await expect(page.getByRole('button', { name: TEXT.appSettings })).toBeVisible();
  });

  test('Phase 1: 앱 설정에서 OpenAI/Anthropic API 키 등록', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openAppSettings(page);

    const openaiToggle = page.locator('#openai-enabled');
    const openaiInput = page.getByPlaceholder(/OpenAI API 키를 입력하세요|Enter your OpenAI API key/i);
    await expect(openaiToggle).toBeDisabled();
    await openaiInput.fill('sk-proj-abcdef1234567890');
    await expect(openaiInput).toHaveAttribute('type', 'password');
    await expect(openaiToggle).toBeEnabled();
    await openaiToggle.check();
    await expect(openaiToggle).toBeChecked();
    await openaiToggle.locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]').getByRole('button', { name: TEXT.clear }).click();
    await expect(openaiInput).toHaveValue('');
    await expect(openaiToggle).toBeDisabled();

    const anthropicToggle = page.locator('#anthropic-enabled');
    const anthropicInput = page.getByPlaceholder(/Anthropic API 키를 입력하세요|Enter your Anthropic API key/i);
    await anthropicInput.fill('sk-ant-abcdef1234567890');
    await expect(anthropicToggle).toBeEnabled();
    await anthropicToggle.check();
    await expect(anthropicToggle).toBeChecked();
  });

  test('Phase 2: Notion 커넥터 연결 다이얼로그 토큰 검증', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openAppSettings(page);
    await expect(page.getByRole('heading', { name: /^(커넥터|Connectors)$/ })).toBeVisible();

    const notionItem = page
      .locator('span', { hasText: /^Notion$/ })
      .first()
      .locator('xpath=ancestor::div[contains(@class,"p-3")][1]');
    await notionItem.getByRole('button', { name: TEXT.connect }).click();

    const notionDialogTitle = page.getByRole('heading', { name: /^(Notion 연결|Connect Notion)$/ });
    await expect(notionDialogTitle).toBeVisible();

    const notionTokenInput = page.getByPlaceholder('ntn_xxx... or secret_xxx...');
    const notionDialogSubmit = page.locator('form').getByRole('button', { name: TEXT.connect });
    await notionTokenInput.fill('invalid-token');
    await notionDialogSubmit.click();
    await expect(page.getByText(/잘못된 형식.*ntn_|Invalid token format/i)).toBeVisible();

    await notionTokenInput.fill('ntn_test_token_1234');
    await notionDialogSubmit.click();
    await expect(notionDialogTitle).toBeHidden();
  });

  test('Phase 3~5: 프로젝트 생성, Source 입력, 번역 가드', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '새 프로젝트 시작하기' }).click();
    const sourceEditor = page.locator('[contenteditable="true"]').first();
    await expect(sourceEditor).toBeVisible();
    await expect(page.getByRole('button', { name: TEXT.translate })).toBeVisible();
    await expect(page.getByRole('button', { name: TEXT.review })).toBeVisible();

    await sourceEditor.click();
    await page.keyboard.type('Guía de Integración de API\nEsta guía proporciona instrucciones.', { delay: 5 });
    await expect(sourceEditor).toContainText('Guía');

    await page.getByRole('button', { name: TEXT.translate }).click();
    await expect(page.getByText(TEXT.targetLanguageWarning)).toBeVisible();

    const targetLanguageSelect = page.getByRole('button', { name: /^(언어 선택|Select Language)$/ }).first();
    await targetLanguageSelect.click();
    await page.getByRole('option', { name: /^(영어|English)$/ }).click();
    await expect(page.getByRole('button', { name: /^(영어|English)$/ }).first()).toBeVisible();
  });

  test('Phase 6~7: Review/AI Chat 패널 진입', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'Review And Chat Test' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await page.getByRole('button', { name: TEXT.review }).click();
    await expect(page.getByTestId('review-run-button')).toBeVisible();

    await openToolsMenu(page);
    await page.getByRole('menuitem', { name: TEXT.aiChat }).click();
    // Chat panel may take a moment to create a session and render
    await expect(page.getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/채팅 모델|Chat model/i)).toBeVisible();

    await page.getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i }).click();
    await expect(page.getByText(TEXT.webSearch)).toBeVisible();
    await expect(page.getByText(TEXT.confluenceSearch)).toBeVisible();
    await expect(page.getByText(TEXT.notionSearch)).toBeVisible();
  });

  test('Phase 8: 히스토리 스냅샷 저장/이름변경/삭제', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'History Workflow Project' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await openToolsMenu(page);
    await page.getByRole('menuitem', { name: TEXT.history }).click();

    await expect(page.getByRole('heading', { name: TEXT.history })).toBeVisible();
    await page.getByRole('button', { name: /^(저장|Save)$/ }).first().click();
    await page.locator('#history-description').fill('마리아 수동 저장');
    await page.getByLabel(/스냅샷 저장|Save Snapshot/i).getByRole('button', { name: TEXT.save }).click();
    await expect(page.getByText('마리아 수동 저장')).toBeVisible();

    const savedItem = page.locator('li').filter({ hasText: '마리아 수동 저장' }).first();
    await savedItem.getByRole('button', { name: TEXT.rename }).click();
    const renameDialog = page.getByRole('dialog').filter({ has: page.locator('#history-rename-description') });
    await renameDialog.locator('#history-rename-description').fill('번역 적용 전 최종본');
    await renameDialog.getByRole('button', { name: TEXT.rename }).click();
    await expect(page.getByText('번역 적용 전 최종본')).toBeVisible();

    const renamedItem = page.locator('li').filter({ hasText: '번역 적용 전 최종본' }).first();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await renamedItem.getByRole('button', { name: TEXT.delete }).click();
    await expect(page.getByText('번역 적용 전 최종본')).toBeHidden();
  });

  test('Phase 9: 프로젝트 컨텍스트 메뉴 - Duplicate', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'API Integration Guide Translation' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectRow = page.locator('[title="API Integration Guide Translation"]').first();
    await expect(projectRow).toBeVisible();

    await projectRow.click({ button: 'right' });
    await page.getByRole('button', { name: '복제 (Duplicate)' }).click();

    await expect(page.getByText('API Integration Guide Translation (Copy)')).toBeVisible();
  });
});
