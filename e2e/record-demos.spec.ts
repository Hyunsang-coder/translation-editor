/**
 * Demo Recording Scenarios for Remotion PromoVideo
 *
 * Playwright recordVideo를 활용하여 각 기능 워크플로우를 WebM으로 녹화합니다.
 * user-story.spec.ts의 인터랙션 패턴을 재사용하되, 시각적 데모에 적합하도록
 * 타이핑 딜레이와 단계 간 대기시간을 추가합니다.
 *
 * Usage:
 *   npx playwright test -c playwright.record.config.ts --headed
 */

import { test, type Page } from '@playwright/test';
import { injectTauriMock, injectTauriMockWithProject } from './tauri-mock';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── Constants ──

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = path.resolve(__dirname, '../remotion-demo/public/recordings');

/** Typing delay (ms per character) — visible but not tedious */
const TYPE_DELAY = 35;

/** Pause between UI steps (ms) */
const STEP_PAUSE = 800;

/** Longer pause for emphasis (after major action) */
const EMPHASIS_PAUSE = 1500;

/** Bilingual text patterns (same as user-story.spec.ts) */
const TEXT = {
  tools: /^(도구|Tools)$/,
  connect: /^(연결|Connect)$/,
  clear: /^(지우기|Clear)$/,
  close: /^(닫기|Close)$/,
  history: /^(히스토리|History)$/,
  save: /^(저장|Save)$/,
  webSearch: /^(웹 검색|Web Search)$/,
  confluenceSearch: /^(Confluence 검색|Confluence Search)$/,
  targetLanguageWarning: /타겟 언어를 선택하세요|Select target language/i,
};

// ── Helpers ──

async function openAppSettings(page: Page): Promise<void> {
  // 앱 설정 진입점은 툴바 우측 기어다(user-story.spec.ts와 동일).
  await page.getByTestId('toolbar-app-settings-button').click();
  await page.waitForTimeout(STEP_PAUSE);
}

/**
 * Rename Playwright's auto-generated video to the desired filename.
 * Playwright saves video as a random UUID.webm in the test's output dir.
 */
async function renameVideo(page: Page, targetName: string): Promise<void> {
  const video = page.video();
  if (!video) return;

  const videoPath = await video.path();
  if (!videoPath) return;

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const dest = path.join(RECORDINGS_DIR, targetName);
  fs.copyFileSync(videoPath, dest);
  console.log(`[record-demos] Saved: ${dest}`);
}

// ── Recording Scenarios ──

test.describe.serial('Demo Recordings', () => {
  test.afterEach(async ({}, testInfo) => {
    // Video rename is handled inside each test via renameVideo()
    console.log(`[record-demos] ${testInfo.title}: ${testInfo.status}`);
  });

  test('1. Translate — AI 번역 워크플로우', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_PAUSE);

    // 새 프로젝트 생성
    await page.getByRole('button', { name: '새 프로젝트 시작하기' }).click();
    await page.waitForTimeout(STEP_PAUSE);

    // Source 에디터에 텍스트 입력
    const sourceEditor = page.locator('[contenteditable="true"]').first();
    await sourceEditor.click();
    await page.waitForTimeout(300);

    await page.keyboard.type('API 통합 가이드', { delay: TYPE_DELAY });
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      '이 가이드는 REST API 엔드포인트 통합에 필요한 단계별 지침을 제공합니다.',
      { delay: TYPE_DELAY },
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      '인증, 요청 형식, 오류 처리 등 핵심 개념을 다룹니다.',
      { delay: TYPE_DELAY },
    );
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 타겟 언어 선택
    const targetLanguageSelect = page
      .getByRole('button', { name: /^(언어 선택|Select Language)$/ })
      .first();
    await targetLanguageSelect.click();
    await page.waitForTimeout(STEP_PAUSE);

    await page.getByRole('option', { name: /^(영어|English)$/ }).click();
    await page.waitForTimeout(STEP_PAUSE);

    // 번역 버튼 클릭 (record-ai.spec.ts와 같은 testid — 라벨 기반은 아이콘화되며 깨졌다)
    await page.getByTestId('editor-translate-button').click();
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 번역 결과 대기 (mock이므로 즉시 완료, 잠시 보여주기)
    await page.waitForTimeout(EMPHASIS_PAUSE);

    await renameVideo(page, 'Translate.webm');
  });

  test('2. Review — 검수 결과 워크플로우', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'API Integration Guide' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_PAUSE);

    // 에디터 영역 확인
    await page.locator('[contenteditable="true"]').first().waitFor();
    await page.waitForTimeout(STEP_PAUSE);

    // Review 패널 열기 (라벨 기반은 아이콘 버튼으로 바뀌며 깨졌다 — testid로 잡는다)
    await page.getByTestId('editor-review-button').click();
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 검수 시작 버튼
    const startReviewBtn = page.getByRole('button', {
      name: /^(검수 시작|Start Review|다시 검수|Review Again)$/,
    });
    await startReviewBtn.waitFor();
    await page.waitForTimeout(STEP_PAUSE);
    await startReviewBtn.click();
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 검수 결과 표시 대기
    await page.waitForTimeout(EMPHASIS_PAUSE);

    await renameVideo(page, 'Review.webm');
  });

  test('3. Add_to_chat — AI 채팅 워크플로우', async ({ page }) => {
    await injectTauriMockWithProject(page, {
      metadata: { title: 'Chat Demo Project' } as never,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_PAUSE);

    await page.locator('[contenteditable="true"]').first().waitFor();

    // AI Chat 열기 — 도구 메뉴가 사라지고 툴바 버튼으로 옮겨졌다.
    await page.getByTestId('toolbar-menu-chat').click();
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 검색 옵션 메뉴 열기
    await page
      .getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i })
      .click();
    await page.waitForTimeout(STEP_PAUSE);

    // 검색 옵션 목록 보여주기 (Web Search, Confluence)
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // 메뉴 닫기 (ESC 또는 바깥 클릭)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(STEP_PAUSE);

    // 채팅 입력
    const chatInput = page.getByPlaceholder(/메시지를 입력|Type a message|Type your message/i);
    if (await chatInput.isVisible()) {
      await chatInput.click();
      await page.waitForTimeout(300);
      await page.keyboard.type(
        '이 문서에서 "인증" 관련 부분을 영어로 자연스럽게 번역해 주세요.',
        { delay: TYPE_DELAY },
      );
      await page.waitForTimeout(EMPHASIS_PAUSE);
    }

    await page.waitForTimeout(EMPHASIS_PAUSE);

    await renameVideo(page, 'Add_to_chat.webm');
  });

  test('5. Get_confluence_info — Confluence 연동 워크플로우', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_PAUSE);

    // 앱 설정 열기
    await openAppSettings(page);
    await page.waitForTimeout(STEP_PAUSE);

    // 쓸 수 있는 provider가 있으면 API 키 섹션이 접힌 채로 열리고 내용이 언마운트된다.
    // (.env.local의 OPENAI_API_KEY가 dev serve 번들에 주입되는 경로 — user-story.spec.ts와 동일)
    const apiKeysToggle = page.getByTestId('app-settings-api-keys-toggle');
    if ((await apiKeysToggle.getAttribute('aria-expanded')) !== 'true') {
      await apiKeysToggle.click();
      await page.waitForTimeout(STEP_PAUSE);
    }

    // API 키 섹션 — OpenAI 키 입력
    const openaiInput = page.getByPlaceholder(
      /OpenAI API 키를 입력하세요|Enter your OpenAI API key/i,
    );
    await openaiInput.scrollIntoViewIfNeeded();
    await page.waitForTimeout(STEP_PAUSE);

    await openaiInput.click();
    await page.keyboard.type('sk-proj-demo-api-key-12345', { delay: TYPE_DELAY });
    await page.waitForTimeout(STEP_PAUSE);

    // OpenAI 토글 활성화
    const openaiToggle = page.locator('#openai-enabled');
    await openaiToggle.check();
    await page.waitForTimeout(EMPHASIS_PAUSE);

    // Confluence 커넥터 영역
    const confluenceItem = page
      .locator('span', { hasText: /^Confluence$/ })
      .first()
      .locator('xpath=ancestor::div[contains(@class,"p-3")][1]');

    if (await confluenceItem.isVisible()) {
      await confluenceItem.scrollIntoViewIfNeeded();
      await page.waitForTimeout(STEP_PAUSE);

      // Confluence 연결 버튼
      const connectBtn = confluenceItem.getByRole('button', { name: TEXT.connect });
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await page.waitForTimeout(EMPHASIS_PAUSE);
      }
    }

    // 설정 화면 전체 모습 보여주기
    await page.waitForTimeout(EMPHASIS_PAUSE);

    await renameVideo(page, 'Get_confluence_info.webm');
  });
});
