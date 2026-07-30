---
name: record-demo
description: AI 주도 데모 영상 녹화. 자연어로 시나리오를 설명하면 Playwright 스크립트를 자동 생성하고 녹화합니다. 데모 영상 촬영, 기능 소개 영상, 프로모 영상 제작 시 사용.
argument-hint: "<자연어 시나리오 설명>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# /record-demo

자연어 설명을 기반으로 AI가 Playwright 녹화 스크립트를 생성하고 실행합니다.

## Usage

```
/record-demo 번역 기능을 보여줘. 기술 문서를 영어로 번역하는 시나리오로.
/record-demo 리뷰 기능 데모. 번역 결과에서 오류를 찾아내는 과정을 보여줘.
/record-demo 채팅에서 Confluence 문서를 검색해서 번역에 활용하는 워크플로우
/record-demo 프로젝트 생성부터 번역, 리뷰, 히스토리 저장까지 전체 흐름
```

---

## Brand Context — 시나리오 생성 전 반드시 참조

### OddEyes.ai란?

> **전문 번역가를 위한 AI 기반 번역 에디터**

**전문 번역가가 주도권을 유지하면서 AI를 도구로 활용**할 수 있는 데스크톱 앱입니다.

### 핵심 철학

- **Translator-led**: AI가 자동으로 문서를 바꾸지 않음. 항상 Preview → Apply.
- **Document-First**: 번역 단위가 문장이 아니라 문서 전체. Notion처럼 자연스러운 에디터.
- **Non-Intrusive AI**: 번역가가 원할 때만 AI를 호출. 채팅, 번역, 리뷰 모두 명시적 액션.

### 타겟 페르소나

| 페르소나 | 특징 | 관심 포인트 |
|---------|------|------------|
| **인하우스 번역가** | 기업 내 전문 번역 담당. 기술/마케팅/법률 문서. 10년차+ | 품질 관리, 일관성, 용어 통일 |
| **프리랜서 번역가** | 다양한 분야. 빠른 납기 압박. 1인 운영 | 생산성, AI 활용, 비용 절감 |
| **로컬라이제이션 팀** | 소프트웨어/게임/앱 번역. 다국어 동시 진행 | Confluence 연동, 협업 |
| **번역 에이전시** | 품질 검수 체계. 복수 번역가 관리 | 리뷰 기능, 히스토리 추적 |

### 경쟁 우위 (데모에서 반드시 드러나야 하는 것)

1. **듀얼 에디터** — Source/Target 나란히. CAT 툴의 세그먼트 방식이 아니라 Notion처럼 자유로운 편집.
2. **원클릭 번역** — 문서 전체를 한 번에 번역. 미리보기 후 적용.
3. **AI 리뷰/검수** — 오역, 누락, 왜곡, 일관성 자동 검출. 하이라이트로 표시.
4. **맥락 기반 AI 채팅** — 번역 문서를 참조하면서 질문/수정 요청 가능.
5. **외부 연동** — Confluence 문서를 직접 가져와서 번역. 웹 검색 참조.
6. **히스토리** — 스냅샷 저장/비교/복원. 번역 이력 추적.

---

## Demo Content Guidelines — 샘플 텍스트 생성 규칙

### 절대 사용하지 않는 텍스트
- "Hello World", "Lorem ipsum" 같은 의미 없는 텍스트
- "테스트입니다", "sample text" 같은 메타 텍스트
- 너무 짧은 한 줄 문장 (데모의 "문서" 느낌이 사라짐)

### 도메인별 추천 샘플 텍스트

사용자가 특정 도메인을 지정하지 않으면, 아래에서 시나리오에 맞게 선택합니다.

#### 기술 문서 (기본, 가장 범용)
```
제목: API 통합 가이드 / 클라우드 마이그레이션 전략 / 보안 정책 문서
내용: 2-3 단락. 제목 + 본문 + 하위 항목 구조.
언어: 한→영 또는 영→한
```

#### 마케팅/비즈니스
```
제목: 2024년 연간 보고서 / 제품 출시 보도자료 / 파트너십 제안서
내용: 비즈니스 톤. 수치/성과 포함.
언어: 한→영 (글로벌 확장 맥락)
```

#### 법률/계약
```
제목: 서비스 이용약관 / NDA 계약서 / 개인정보 처리방침
내용: 법률 용어 포함. 정확한 번역이 중요함을 보여주기 좋음.
언어: 한→영 또는 영→한
```

#### 의료/제약
```
제목: 임상시험 프로토콜 / 의약품 설명서 / 환자 동의서
내용: 전문 용어. 리뷰 기능의 가치를 보여주기 좋음.
언어: 영→한
```

#### 소프트웨어/게임
```
제목: UI 문자열 / 게임 대사 / 앱 스토어 설명
내용: 짧은 문자열 + 맥락 설명. Confluence 연동 데모에 적합.
언어: 영→한 또는 한→일
```

### 텍스트 분량 기준
- **최소**: 제목 + 2단락 (번역 기능의 가치가 느껴지려면)
- **적정**: 제목 + 3-4단락 (에디터가 "문서"처럼 보임)
- **최대**: 제목 + 소제목 2개 + 각 2단락 (계층 구조 시연)

---

## Demo Tone & Pacing — 데모 분위기

### 전체 톤
- **전문적이되 친근하게**: 번역가가 "이거 내 업무에 쓰겠다"고 느끼는 수준
- **효율성 강조**: 클릭 수를 최소화하는 워크플로우를 보여줌
- **결과 중심**: 입력보다 결과(번역 완료, 리뷰 결과, 채팅 응답)에 시간을 더 할당

### 시나리오 구성 원칙
1. **문제 → 해결**: "이 문서를 번역해야 한다" → "원클릭으로 완료"
2. **점진적 깊이**: 기본 기능 → 고급 기능 순서 (번역 → 리뷰 → 채팅 → 커넥터)
3. **실제 워크플로우 반영**: 번역가의 실제 작업 순서를 따름

### Do's and Don'ts

**Do's:**
- 실제 전문 번역가가 다룰 법한 텍스트 사용
- UI가 깔끔하게 보이는 순간에 충분히 pause
- 듀얼 에디터(Source/Target)가 동시에 보이는 장면 강조
- 프로젝트 제목을 현실적으로 (예: "API 통합 가이드 v2.1")

**Don'ts:**
- 너무 빠르게 지나가서 뭘 했는지 모르게 하지 않기
- 에러/실패 시나리오를 메인 데모에 넣지 않기 (별도 시나리오로)
- 설정 화면에 오래 머물지 않기 (설정은 수단, 결과가 목적)
- 빈 에디터 화면을 오래 보여주지 않기 (텍스트 입력을 빠르게)

---

## Workflow

사용자의 자연어 설명을 받으면 다음 순서로 진행합니다:

### Step 1: 시나리오 설계

사용자 설명 + 위의 Brand Context를 결합하여 시나리오를 설계합니다:
- **타겟 페르소나**: 이 데모를 볼 사람은 누구인가?
- **보여줄 기능**: 어떤 경쟁 우위를 강조할 것인가?
- **샘플 텍스트**: 페르소나에 맞는 도메인의 텍스트를 생성
- **흐름 구성**: 문제 → 해결 구조로 시나리오 구성
- **강조 포인트**: 핵심 순간에 EMPHASIS_PAUSE 배치

### Step 2: Playwright 스크립트 생성

`e2e/record-ai.spec.ts` 파일에 녹화 스크립트를 생성합니다.

### Step 3: 녹화 실행

```bash
npx playwright test -c playwright.record.config.ts --headed -g "AI Demo"
```

### Step 4: 결과 안내

녹화된 WebM 파일 경로와 Remotion 렌더링 방법을 안내합니다.

---

## App UI Map (셀렉터 레퍼런스)

AI가 스크립트를 생성할 때 다음 셀렉터들을 사용합니다.

### Pages & Navigation

| 화면 | 진입 방법 |
|------|-----------|
| 프로젝트 목록 | 앱 시작 시 (첫 화면) |
| 에디터 | 프로젝트 클릭 또는 "새 프로젝트 시작하기" 클릭 |
| 앱 설정 모달 | `getByRole('button', { name: /^(앱 설정\|App Settings)$/ })` |

### Editor Area

```typescript
// Source 에디터 (좌측)
const sourceEditor = page.locator('[contenteditable="true"]').first();

// Target 에디터 (우측) — 번역 결과가 여기에 표시됨
const targetEditor = page.locator('[contenteditable="true"]').last();

// 타겟 언어 선택
const langSelect = page.getByRole('button', { name: /^(언어 선택|Select Language)$/ }).first();
// 언어 옵션: 영어(English), 한국어(Korean), 일본어(Japanese), 중국어(Chinese) 등
await page.getByRole('option', { name: /^(영어|English)$/ }).click();
```

### Toolbar Buttons

```typescript
// 번역
page.getByRole('button', { name: /^(번역|Translate)$/ })

// 검수(리뷰)
page.getByRole('button', { name: /^(검수|Review)$/ })

// 히스토리
page.getByRole('button', { name: /^(히스토리|History)$/ })

// 도구 메뉴 (채팅, 웹검색 등)
page.locator('button[title="도구"], button[title="Tools"]')
```

### Tools Menu (도구 메뉴 하위)

```typescript
// 도구 메뉴를 먼저 열고:
await page.locator('button[title="도구"], button[title="Tools"]').click();

// AI 채팅
page.getByRole('button', { name: /^(AI 채팅|AI Chat)$/ })
```

### Chat Panel

```typescript
// 채팅 입력
page.getByPlaceholder(/메시지를 입력|Type a message|Type your message/i)

// 검색 옵션 메뉴
page.getByRole('button', { name: /검색 옵션 메뉴 열기|Open search options menu/i })
```

### Settings Modal

```typescript
// 앱 설정 열기
await page.getByRole('button', { name: /^(앱 설정|App Settings)$/ }).click();

// OpenAI API 키 입력
page.getByPlaceholder(/OpenAI API 키를 입력하세요|Enter your OpenAI API key/i)

// Confluence 커넥터
page.locator('span', { hasText: /^Confluence$/ }).first()
  .locator('xpath=ancestor::div[contains(@class,"p-3")][1]')

// 연결/Connect 버튼
connectorItem.getByRole('button', { name: /^(연결|Connect)$/ })

// 닫기
page.getByRole('button', { name: /^(닫기|Close)$/ })
```

### Review Panel

```typescript
// 검수 시작
page.getByRole('button', { name: /^(검수 시작|Start Review|다시 검수|Review Again)$/ })
```

### History Panel

```typescript
// 히스토리 버튼 클릭 → 패널 열림
page.getByRole('button', { name: /^(히스토리|History)$/ })

// 저장 버튼
page.getByRole('button', { name: /^(저장|Save)$/ })
```

### New Project (프로젝트 목록 화면)

```typescript
// 새 프로젝트
page.getByRole('button', { name: '새 프로젝트 시작하기' })

// 기존 프로젝트 클릭
page.locator('[data-testid="project-card"]').first()
```

---

## Script Template

생성할 스크립트는 반드시 다음 구조를 따릅니다:

```typescript
import { test, type Page } from '@playwright/test';
import { injectTauriMock, injectTauriMockWithProject } from './tauri-mock';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = path.resolve(__dirname, '../remotion-demo/public/recordings');

// ── Timing Constants ──
const TYPE_DELAY = 35;      // 타이핑 속도 (ms/char)
const STEP_PAUSE = 800;     // 단계 간 대기
const EMPHASIS_PAUSE = 1500; // 강조 대기 (중요 액션 후)

// ── Helpers ──
async function renameVideo(page: Page, targetName: string): Promise<void> {
  const video = page.video();
  if (!video) return;
  const videoPath = await video.path();
  if (!videoPath) return;
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const dest = path.join(RECORDINGS_DIR, targetName);
  fs.copyFileSync(videoPath, dest);
  console.log(`[record-ai] Saved: ${dest}`);
}

// ── AI Generated Scenario ──
test.describe.serial('AI Demo Recording', () => {
  test('시나리오 제목', async ({ page }) => {
    // 1. Mock 주입 (빈 프로젝트 시작 or 기존 프로젝트)
    await injectTauriMock(page);
    // 또는: await injectTauriMockWithProject(page, { metadata: { title: '...' } as never });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_PAUSE);

    // 2. 시나리오 액션들...
    // AI가 사용자 설명에 맞게 생성

    // 3. 비디오 저장
    await renameVideo(page, 'AI_Demo.webm');
  });
});
```

---

## Tauri Mock 사용법

### 빈 상태에서 시작 (프로젝트 생성부터)
```typescript
await injectTauriMock(page);
```

### 프로젝트가 이미 있는 상태에서 시작
```typescript
await injectTauriMockWithProject(page, {
  metadata: { title: 'My Project' } as never,
});
```

### Mock이 지원하는 주요 명령
- 프로젝트 CRUD (create, load, save, delete, duplicate)
- 채팅 세션 (save/load)
- 히스토리 스냅샷 (create, list, get, delete, rename)
- 시크릿/API 키 (get, set, delete)
- MCP/커넥터 (기본 응답, 연결 성공 시뮬레이션)
- Confluence (빈 결과 반환)

**주의**: Mock에서는 실제 AI 응답이 없습니다. 번역/리뷰/채팅 결과는 UI 인터랙션만 보여줍니다.

---

## Timing Guidelines

| 상황 | 대기 시간 | 용도 |
|------|-----------|------|
| `STEP_PAUSE` (800ms) | 일반 클릭 후 | 사용자가 UI 변화를 인지 |
| `EMPHASIS_PAUSE` (1500ms) | 중요 액션 후 | 결과 강조, 핵심 기능 보여주기 |
| `TYPE_DELAY` (35ms) | 타이핑 | 자연스러운 입력 속도 |
| 300ms | 포커스 후 | 입력 필드 활성화 대기 |
| 2000-3000ms | 최종 결과 | 시나리오 끝에서 결과 화면 유지 |

**팁**: 사용자가 "천천히", "강조해서" 등의 지시를 하면 EMPHASIS_PAUSE를 2500-3000ms로 늘립니다.

---

## Execution

스크립트 생성 후 다음 명령으로 녹화합니다:

```bash
# Vite 서버가 실행 중이어야 함 (config에서 자동 시작하지만, 이미 떠있으면 재사용)
npx playwright test -c playwright.record.config.ts --headed -g "AI Demo"
```

### 출력 파일
- **녹화**: `remotion-demo/public/recordings/<filename>.webm`
- **Remotion 렌더링** (선택):
  ```bash
  cd remotion-demo
  npx remotion render src/index.ts FeatureVideo out/<filename>.mp4 \
    --props='{"feature":"<feature_name>"}'
  ```

---

## Important Notes

1. **테스트 매칭**: `playwright.record.config.ts`의 `testMatch`에 `record-ai.spec.ts`가 포함되어 있으므로, AI 생성 스크립트는 **`e2e/record-ai.spec.ts`**에 작성합니다.
2. **Headed 모드**: 녹화는 반드시 `--headed`로 실행 (화면이 보여야 녹화됨).
3. **순차 실행**: 여러 시나리오가 있어도 `workers: 1`로 순차 실행.
4. **파일명 규칙**: WebM 파일명은 Remotion의 `FEATURES` 배열과 매칭되어야 합니다 (기존: Translate, Review, Add_to_chat, Connector, Get_confluence_info).
5. **기존 스크립트 보존**: `record-demos.spec.ts`는 수정하지 않습니다. AI 생성 스크립트는 항상 `record-ai.spec.ts`에 작성합니다.
