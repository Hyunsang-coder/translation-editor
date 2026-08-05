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
  clear: /^(지우기|Clear)$/,
  close: /^(닫기|Close)$/,
  history: /^(히스토리|History)$/,
  save: /^(저장|Save)$/,
  rename: /^(이름 변경|Rename)$/,
  delete: /^(삭제|Delete)$/,
  webSearch: /^(웹 검색|Web Search)$/,
  confluenceSearch: /^(Confluence 검색|Confluence Search)$/,
  targetLanguageWarning: /타겟 언어를 선택하세요|Select target language/i,
};

async function openAppSettings(page: Page): Promise<void> {
  // 앱 설정 진입점은 툴바의 프로젝트 드롭다운 하단에 있다.
  await page.getByTestId('project-picker-trigger').click();
  await page.getByTestId('project-app-settings-button').click();
  await expect(page.getByRole('heading', { name: TEXT.appSettings })).toBeVisible();
}


test.describe('User Story: Maria의 번역 워크플로우', () => {
  test('Phase 1: 초기 진입과 빈 프로젝트 상태', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: '새 프로젝트 시작하기' })).toBeVisible();
    // 프로젝트가 없어도 툴바(프로젝트 드롭다운)는 렌더된다 — 목록·앱 설정 진입점이 여기뿐이다.
    await page.getByTestId('project-picker-trigger').click();
    await expect(page.getByTestId('project-app-settings-button')).toBeVisible();
  });

  test('Phase 1: 앱 설정에서 OpenAI/Anthropic API 키 등록', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openAppSettings(page);

    // API 키 섹션은 쓸 수 있는 provider가 있으면 접힌 채로 열리고(defaultOpen), 접히면
    // 내용이 언마운트된다. .env.local의 OPENAI_API_KEY는 dev serve 번들에 주입되므로
    // (vite.config.ts의 __DEV_OPENAI_API_KEY__) 로컬에서만 이 경로를 탔다. 명시적으로 펼친다.
    const apiKeysToggle = page.getByTestId('app-settings-api-keys-toggle');
    if ((await apiKeysToggle.getAttribute('aria-expanded')) !== 'true') {
      await apiKeysToggle.click();
    }
    await expect(apiKeysToggle).toHaveAttribute('aria-expanded', 'true');

    const openaiToggle = page.locator('#openai-enabled');
    const openaiInput = page.getByPlaceholder(/OpenAI API 키를 입력하세요|Enter your OpenAI API key/i);
    const openaiSection = openaiToggle.locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
    if (await openaiToggle.isEnabled()) {
      await openaiSection.getByRole('button', { name: TEXT.clear }).click();
    }
    await expect(openaiToggle).toBeDisabled();
    await openaiInput.fill('sk-proj-abcdef1234567890');
    await expect(openaiInput).toHaveAttribute('type', 'password');
    await expect(openaiToggle).toBeEnabled();
    await openaiToggle.check();
    await expect(openaiToggle).toBeChecked();
    await openaiSection.getByRole('button', { name: TEXT.clear }).click();
    await expect(openaiInput).toHaveValue('');
    await expect(openaiToggle).toBeDisabled();

    const anthropicToggle = page.locator('#anthropic-enabled');
    const anthropicInput = page.getByPlaceholder(/Anthropic API 키를 입력하세요|Enter your Anthropic API key/i);
    const anthropicSection = anthropicToggle.locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
    if (await anthropicToggle.isEnabled()) {
      await anthropicSection.getByRole('button', { name: TEXT.clear }).click();
    }
    await anthropicInput.fill('sk-ant-abcdef1234567890');
    await expect(anthropicToggle).toBeEnabled();
    await anthropicToggle.check();
    await expect(anthropicToggle).toBeChecked();
  });

  test('Phase 3~5: 프로젝트 생성, Source 입력, 번역 가드', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '새 프로젝트 시작하기' }).click();
    const sourceEditor = page.locator('[contenteditable="true"]').first();
    await expect(sourceEditor).toBeVisible();
    await expect(page.getByTestId('editor-translate-button')).toBeVisible();
    await expect(page.getByTestId('editor-review-button')).toBeVisible();

    await sourceEditor.click();
    await page.keyboard.type('Guía de Integración de API\nEsta guía proporciona instrucciones.', { delay: 5 });
    await expect(sourceEditor).toContainText('Guía');

    await page.getByTestId('editor-translate-button').click();
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
    // 검수는 번역·폴리싱과 같이 시작 모달을 거쳐 패널을 연다
    await page.getByTestId('editor-review-button').click();
    await expect(page.getByTestId('review-instruction-input')).toBeVisible();
    await page.getByTestId('review-modal-start').click();
    await expect(page.getByTestId('review-panel')).toBeVisible();

    await page.getByTestId('toolbar-menu-chat').click();
    // Chat panel may take a moment to create a session and render
    await expect(page.getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/채팅 세션 AI provider|Chat session AI provider/i)).toBeVisible();

    await page.getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i }).click();
    await expect(page.getByText(TEXT.webSearch)).toBeVisible();
    await expect(page.getByText(TEXT.confluenceSearch)).toBeVisible();
  });

  test('Phase 8: 히스토리 스냅샷 저장/이름변경/삭제', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'History Workflow Project' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await page.getByTestId('toolbar-menu-history').click();

    // 상태 스트립도 최신 스냅샷 설명을 표시하므로 단언은 드로어로 한정한다.
    const historyDrawer = page.locator('aside').filter({ has: page.getByRole('heading', { name: TEXT.history }) });
    await expect(page.getByRole('heading', { name: TEXT.history })).toBeVisible();
    await page.getByRole('button', { name: /^(저장|Save)$/ }).first().click();
    await page.locator('#history-description').fill('마리아 수동 저장');
    await page.getByLabel(/스냅샷 저장|Save Snapshot/i).getByRole('button', { name: TEXT.save }).click();
    await expect(historyDrawer.getByText('마리아 수동 저장')).toBeVisible();

    const savedItem = page.locator('li').filter({ hasText: '마리아 수동 저장' }).first();
    await savedItem.getByRole('button', { name: TEXT.rename }).click();
    const renameDialog = page.getByRole('dialog').filter({ has: page.locator('#history-rename-description') });
    await renameDialog.locator('#history-rename-description').fill('번역 적용 전 최종본');
    await renameDialog.getByRole('button', { name: TEXT.rename }).click();
    await expect(historyDrawer.getByText('번역 적용 전 최종본')).toBeVisible();

    const renamedItem = page.locator('li').filter({ hasText: '번역 적용 전 최종본' }).first();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await renamedItem.getByRole('button', { name: TEXT.delete }).click();
    await expect(historyDrawer.getByText('번역 적용 전 최종본')).toBeHidden();
  });

  test('Phase 9: 프로젝트 컨텍스트 메뉴 - Duplicate', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'API Integration Guide Translation' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('project-picker-trigger').click();
    const projectRow = page
      .getByTestId('project-picker-menu')
      .locator('[title="API Integration Guide Translation"]')
      .first();
    await expect(projectRow).toBeVisible();

    // WKWebView에서는 툴바 안에 중첩된 팝오버가 뒤쪽 textarea보다 위에 보여도
    // 우클릭 hit-test는 textarea가 가져갈 수 있다. 메뉴는 body 최상위 overlay여야 한다.
    const menuUsesTopLevelOverlay = await page.getByTestId('project-picker-menu').evaluate(
      (menu) => menu.parentElement === document.body
    );
    expect(menuUsesTopLevelOverlay).toBe(true);

    await projectRow.click({ button: 'right' });
    await page.getByRole('button', { name: '복제 (Duplicate)' }).click();

    await expect(page.getByText('API Integration Guide Translation (Copy)')).toBeVisible();
  });

  test('Phase 9: 프로젝트 컨텍스트 메뉴 - Rename/Delete', async ({ page }) => {
    const originalTitle = 'Project Actions Test';
    const renamedTitle = 'Renamed Project';
    await injectTauriMockWithProject(page, {
      metadata: { title: originalTitle } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('project-picker-trigger').click();
    const originalRow = page.getByTestId('project-picker-menu').locator(`[title="${originalTitle}"]`);
    await originalRow.click({ button: 'right' });
    await page.getByRole('button', { name: '이름 변경 (Rename)' }).click();

    const renameInput = page.getByTestId('project-picker-menu').locator('input').first();
    await expect(renameInput).toHaveValue(originalTitle);
    await renameInput.fill(renamedTitle);
    await renameInput.press('Enter');
    const renamedRow = page.getByTestId('project-picker-menu').locator(`[title="${renamedTitle}"]`);
    await expect(renamedRow).toBeVisible();

    await renamedRow.click({ button: 'right' });
    await page.getByRole('button', { name: '삭제 (Delete)' }).click();
    await expect(renamedRow).toBeHidden();
  });

  test('Phase 9: 프로젝트 선택 시 열린 컨텍스트 메뉴도 함께 닫힌다', async ({ page }) => {
    const originalTitle = 'Context Menu Owner';
    await injectTauriMockWithProject(page, {
      metadata: { title: originalTitle } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('project-picker-trigger').click();
    const menu = page.getByTestId('project-picker-menu');
    const originalRow = menu.locator(`[title="${originalTitle}"]`);
    await originalRow.click({ button: 'right' });
    await page.getByRole('button', { name: '복제 (Duplicate)' }).click();

    const copiedRow = menu.locator(`[title="${originalTitle} (Copy)"]`);
    await expect(copiedRow).toBeVisible();
    await originalRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: '복제 (Duplicate)' })).toBeVisible();

    // 컨텍스트 메뉴와 겹치지 않는 행의 왼쪽을 클릭해 프로젝트를 전환한다.
    await copiedRow.click({ position: { x: 12, y: 12 } });
    await expect(menu).toBeHidden();
    await expect(page.getByRole('button', { name: '복제 (Duplicate)' })).toBeHidden();
  });

  test('Phase 9: 프로젝트 메뉴는 열린 모달보다 아래 레이어에 머문다', async ({ page }) => {
    await injectTauriMockWithProject(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openAppSettings(page);
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: TEXT.appSettings }) });
    await expect(dialog).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('app:open-project-picker')));
    const projectMenu = page.getByTestId('project-picker-menu');
    await expect(projectMenu).toBeAttached();

    const { dialogZIndex, projectMenuZIndex } = await page.evaluate(() => {
      const dialogElement = document.querySelector<HTMLElement>('[role="dialog"]');
      const menuElement = document.querySelector<HTMLElement>('[data-testid="project-picker-menu"]');
      if (!dialogElement || !menuElement) throw new Error('Expected modal and project menu');
      return {
        dialogZIndex: Number.parseInt(getComputedStyle(dialogElement).zIndex, 10),
        projectMenuZIndex: Number.parseInt(getComputedStyle(menuElement).zIndex, 10),
      };
    });
    expect(dialogZIndex).toBeGreaterThan(projectMenuZIndex);
  });
});
