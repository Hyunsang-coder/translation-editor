import { test, expect } from '@playwright/test';
import { injectTauriMock, injectTauriMockWithProject } from './tauri-mock';

/**
 * E2E User Story: Maria의 번역 워크플로우
 *
 * Tauri mock layer를 주입하여 실제 React/TipTap/Zustand가 동작하되,
 * invoke() 호출만 mock 데이터를 반환합니다.
 */

test.describe('User Story: Maria의 번역 워크플로우', () => {
  test('프로젝트 목록 페이지 접근 (빈 상태)', async ({ page }) => {
    // Arrange: mock 주입 (프로젝트 없음)
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Assert: 빈 상태 → "새 프로젝트 시작하기" 버튼이 보여야 함
    const createBtn = page.locator('button', { hasText: '새 프로젝트 시작하기' });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
  });

  test('Phase 3: 프로젝트 생성', async ({ page }) => {
    // Arrange: mock 주입 (빈 상태)
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Act: 빈 상태에서 프로젝트 생성 버튼 클릭
    const createBtn = page.locator('button', { hasText: '새 프로젝트 시작하기' });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // Assert: 에디터 캔버스가 로드됨 (TipTap contenteditable 등장)
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
  });

  test('Phase 4: 문서 입력 (Source 에디터)', async ({ page }) => {
    // Arrange: 프로젝트가 이미 있는 상태로 mock 주입
    await injectTauriMockWithProject(page, {
      metadata: { title: 'Document Input Test' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Source 에디터 (첫 번째 contenteditable) 대기
    const sourceEditor = page.locator('[contenteditable="true"]').first();
    await expect(sourceEditor).toBeVisible({ timeout: 10_000 });

    // Act: Source 에디터에 텍스트 입력
    await sourceEditor.click();
    const sampleText = 'Guía de Integración de API';
    await page.keyboard.type(sampleText, { delay: 10 });

    // Assert: 텍스트가 에디터에 나타남
    await expect(sourceEditor).toContainText('Guía', { timeout: 5_000 });
  });

  test('Phase 5: 번역 버튼 존재 확인', async ({ page }) => {
    // Arrange: 프로젝트가 있는 상태
    await injectTauriMockWithProject(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 에디터 로드 대기
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // Assert: 번역 버튼이 존재하고 클릭 가능
    // ko: "번역", en: "Translate"
    const translateBtn = page.locator('button').filter({
      has: page.locator('text=/^(번역|Translate)$/'),
    });
    await expect(translateBtn).toBeVisible({ timeout: 5_000 });
    await expect(translateBtn).toBeEnabled();
  });

  test('Phase 6: 검수 버튼 존재 확인', async ({ page }) => {
    // Arrange: 프로젝트가 있는 상태
    await injectTauriMockWithProject(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 에디터 로드 대기
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // Assert: 검수 버튼이 존재하고 클릭 가능
    // ko: "검수", en: "Review"
    const reviewBtn = page.locator('button').filter({
      has: page.locator('text=/^(검수|Review)$/'),
    });
    await expect(reviewBtn).toBeVisible({ timeout: 5_000 });
    await expect(reviewBtn).toBeEnabled();
  });
});
