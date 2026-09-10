# Provider 단일 선택 모델 체계 (작업 계획)

작성: 2026-07-30 / 상태: **구현 완료** ([ADR-0012](adr/0012-provider-only-model-selection.md))

> 결정의 근거와 버린 대안은 ADR-0012가 진실입니다. 이 문서는 작업 기록입니다.

사용자가 고르는 값을 **`provider` 하나**로 줄이고, 용도별 모델·effort는 앱이 고정한다.
프리셋 6개 선택 방식(`MODEL_PRESETS`)을 폐기한다.

---

## 1. 왜 하는가

현재 **번역·검수·폴리싱이 모델 설정 하나(`translationModel`)를 공유**한다.

```ts
// src/ai/config.ts:145
const rawModel = (useFor === 'translation' || useFor === 'review')
  ? store.translationModel   // 번역·검수 공용
  : store.chatModel;         // 채팅만 별도
// src/ai/polishDocument.ts:155 → getAiConfig({ useFor: 'translation' }) 이므로 폴리싱도 여기
```

사용자는 "번역은 Sonnet 5, 검수는 Opus 5"를 원해 **작업 전마다 드롭다운을 손으로 바꾸고 있었다.**
그 결과 검수용으로 Opus 5로 바꾼 뒤 폴리싱을 돌리면 **폴리싱도 Opus 5로 실행된다.**

한국어 20,000자 문서 1사이클 기준 (Sonnet 5 정가 $3/$15, Opus 5 $5/$25):

| 단계 | 모델 | 비용 |
|---|---|---|
| 번역 | Sonnet 5 | $0.37 |
| 검수 | Opus 5 | $0.71 |
| 폴리싱 | Sonnet 5로 되돌린 경우 | $0.37 → 합계 **$1.44** |
| 폴리싱 | **Opus 5인 채로 둔 경우** | $0.61 → 합계 **$1.69** |

**드롭다운을 되돌렸는지에 15%가 걸려 있다.** 이 실수를 구조적으로 불가능하게 만드는 것이 목적이다.

부수 효과로 **프리셋 fallback 함정**도 사라진다 — 현재 저장값이 목록에 없거나 provider가 비활성이면
`presets[0]`(= Opus 5)로 조용히 교체된다(`config.ts:131`, `ChatContent.tsx:216`, `WorkflowActions.tsx:76`).

---

## 2. 확정 설계

사용자가 고르는 값: **`provider: 'anthropic' | 'openai'` 하나.**

| 용도 (`ModelUseFor`) | Anthropic | OpenAI |
|---|---|---|
| `translation` (선택 재번역 포함) | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| **`review`** | **`claude-opus-5` · high** | **`gpt-5.6-sol` · high** |
| `polish` (신설) | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| `chat` | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| `summary` (내부, 비노출) | **`claude-sonnet-5` · medium** | `gpt-5.6-luna` · medium |

### 결정 사항

- **effort는 전부 `high` 고정** (요약만 `medium`). 용도별 차등을 두지 않기로 사용자가 결정했다.
  Anthropic API 기본값이 이미 high지만, 기본값이 바뀌어도 흔들리지 않도록 **명시적으로 전송**한다.
  - 2026-07-30 재검토: **폴리싱만 `medium`으로 내리는 안을 다시 논의하고 기각**했다. 산출물이
    곧 문서 본문이고 판단이 미묘한 작업이라 effort 의존도가 번역보다 높은데, 출력 대부분이
    thinking이 아니라 문서 본문이라 절감은 사이클당 ~8%에 그친다. 게다가 선택 재번역이
    `translation`(high)에 묶여 있어 **문단 하나 다듬을 때가 문서 전체보다 effort가 높아지는
    역전**이 생긴다. 긴 문서에서 `---POLISH_END---` 유실이 관측되면 그때 재검토한다.
- **Haiku 4.5 완전 제거.** 요약이 Sonnet 5로 옮겨가므로 남길 이유가 없다.
- **세션별 선택은 "모델"에서 "provider"로 축소**하되 유지한다. `chat_sessions.model_preset` 컬럼을
  값만 바꿔(`anthropic`/`openai`) 재활용한다.
- `MODEL_PRESETS` / `resolveModelFromPreset` 폐기 → provider×용도 매핑 하나로 대체.

### 세션 provider 규칙 (현행 동작을 그대로 계승)

| 상황 | 동작 | 근거 |
|---|---|---|
| 새 세션 생성 | 그 시점 전역 provider를 **복사해서 고정(pin)** | `chatStore.session.ts:328` |
| 첫 메시지 전 | 이 세션만 변경 가능 | `chatStore.session.ts:407` |
| 첫 메시지 이후 | **잠금** | 캐시 키에 모델이 포함되어, 바꾸면 세션 캐시 전멸 |
| 전역 provider 변경 | 기존 세션 유지, 새 세션부터 적용 | pin 의미 |
| 선택된 provider의 API 키 없음 | 키 있는 provider로 자동 전환 | 현재는 `presets[0]`로 튐 |

---

## 3. 검증된 사실 (재조사 불필요)

2026-07-30 공식 문서로 확인. 새 세션에서 다시 찾지 말 것.

### Anthropic

| 모델 | 입력/출력 | 캐시 read / 5m write | 최소 캐시 | 컨텍스트 |
|---|---|---|---|---|
| Opus 5 | $5 / $25 | $0.50 / $6.25 | 512 | 1M |
| Sonnet 5 | $3 / $15 (**도입가 $2/$10, 2026-08-31까지**) | $0.30 / $3.75 | 1,024 | 1M |
| Haiku 4.5 | $1 / $5 | $0.10 / $1.25 | 4,096 | 200k |

- 캐시: read 0.1×, 5m write 1.25×, **1h write 2×** (read는 동일). **히트할 때마다 TTL이 무료로 갱신된다.**
- breakpoint는 요청당 **최대 4개**. 현재 채팅이 3개 사용(system / 마지막 HumanMessage / modelSettings 꼬리).
- 프리픽스 계층은 **`tools` → `system` → `messages`**. 상위가 바뀌면 하위가 전부 무효.
- `effort` 기본값은 **high**이고, `"high"` 명시 == 생략 (문서: *"exactly the same behavior"*).
  **effort를 바꾸면 캐시 프리픽스가 무효화**되므로 한 대화 안에서 변경 금지.
- Sonnet 5 `medium` ≈ "Sonnet 4.6 at high effort" (문서 기준).
- Opus 4.5+ / Sonnet 4.6+ 는 툴 루프에서 thinking 블록이 보존되어 캐시가 유지된다. **Haiku는 무효화된다.**

### OpenAI (이번 범위에서는 매핑 값만 쓰지만 기록)

- Sol $5 / $30, Luna $1 / $6. cached input 0.1×, **GPT-5.6+는 cache write 1.25×**.
- **GPT-5.6+는 `prompt_cache_key`를 보내야 캐시 매칭이 신뢰 가능하다.** 앱은 현재 보내지 않는다.
- `ai.rs:97`의 "OpenAI는 캐시 write 과금이 없다" 주석과 `cache_creation_input_tokens: 0` 하드코딩은
  **GPT-5.6 기준으로 틀렸다.** (별도 항목, 아래 §7)
- TTL 기본 30분, 최소 프리픽스 1,024 토큰. 272k 초과 요청은 2× 과금.

### 프롬프트 크기 실측 (`approxTokens` 기준)

| 구성요소 | 토큰 |
|---|---|
| 채팅 툴 정의 (general 프로필 9개) | 1,603 |
| 채팅 system 기본(질문 모드) | ~760 |
| 검수 고정 프롬프트 (`TWO_PASS_REVIEW_PROMPT`) | 2,010 |
| 폴리싱 고정 지침 | ~1,000 |
| 번역 고정 지침 | ~370 |

---

## 4. 손댈 파일

### 1단계 — Notion MCP 제거 작업과 충돌 없음

| 파일 | 작업 |
|---|---|
| `src/ai/config.ts` | `MODEL_PRESETS`/`resolveModelFromPreset` 제거 → provider×용도 매핑. `getAiConfig`/`resolveModelRunConfig`가 `useFor`로 모델·effort 결정 |
| `src/stores/aiConfigStore.ts` | `translationModel`/`chatModel` → `provider`. **v13 → v14 마이그레이션** |
| `src/ai/modelCallOptions.ts` | `ModelUseFor`에 `'polish'`·`'summary'` 추가. 프리셋 기반 effort 분기 제거, 매핑 값 전달 |
| `src/ai/client.ts` | `useFor` 타입 확장, maxTokens 분기(`:65`, `:91`) 갱신 |
| `src/ai/polishDocument.ts` | `getAiConfig({ useFor: 'polish' })` (현재 `:155`에서 `'translation'`) |
| `src/ai/review/runReview.ts` | `useFor: 'review'` 유지 — 이제 실제로 다른 모델로 해석됨 |
| `src/ai/retranslateSelection.ts` | `useFor: 'translation'` 유지 (번역에 묶는다) |
| `src/ai/chatContext/summarizeConversation.ts` | `SUMMARY_PRESET_BY_PROVIDER` 제거 → `useFor: 'summary'` |
| `src/desktop/translationPreviewActions.ts:100` | `translationModel` 직접 참조 제거 → 용도별 해석 함수 |
| `src/stores/chatStore.session.ts` | 세션 pin 값을 provider로 (`:197` legacy hydrate, `:328` 새 세션, `:407` 잠금) |
| `src/components/layout/WorkflowActions.tsx` | 드롭다운을 provider 2개로. fallback 로직(`:76`) 정리 |
| 테스트 | `config.test.ts`, `modelCallOptions.test.ts`, `aiConfigStore.test.ts`, `modelRunConfig.test.ts` |

### 2단계 — Notion MCP 제거 커밋 이후

`ChatContent.tsx`(세션 드롭다운 `:222`·`:248`·`:1080`) · `AppSettingsModal.tsx` · `i18n ko/en`.

> 2026-07-30 기준 Notion MCP 제거 작업이 동시 진행 중이며 위 3개 파일이 그 작업 경로에 있다.
> 같은 작업 트리라 git 충돌은 없지만 **동시 편집 덮어쓰기**를 피하려고 분리했다.

---

## 5. 함정 (반드시 확인)

1. **Haiku 제거 순서** — `SUMMARY_PRESET_BY_PROVIDER`(`summarizeConversation.ts:19`)가 Haiku를
   하드코딩하고 있고 요약은 입력 예산 75%에서 **자동 트리거**된다. 매핑 교체를 먼저 하고 프리셋을 지울 것.
   순서가 바뀌면 요약이 조용히 최상위 모델로 승격된다.
2. **`translationPreviewActions.ts:100`** — Desktop MCP 경로가 `translationModel`을 직접 읽는다.
   MCP 계약 자체에는 모델이 노출돼 있지 않아 breaking은 아니지만 컴파일이 깨진다.
3. **세션 잠금 유지** — 첫 메시지 이후 변경 금지(`chatStore.session.ts:407`). provider 축에서는
   API 자체가 바뀌므로 더 중요하다. 삭제하지 말 것.
4. **`ChatMessageMetadata.requestedModelPreset`**(`types/index.ts:466`) — 과거 메시지에 프리셋
   문자열이 저장돼 있다. 표시 경로가 깨지지 않게 할 것.
5. **`pricing.ts`의 `MODEL_PRICES`는 그대로 둔다** — 키가 실제 API 모델 ID이고 사용량 장부가
   모델 ID를 남기므로, 프리셋이 사라져도 유효하다.
6. **DB 컬럼명은 `model_preset` 유지**(`src-tauri/src/db/schema.rs:70`). 값 의미만 바뀐다.
   컬럼 rename은 마이그레이션 비용 대비 실익이 없다.

### 마이그레이션 방침 (v13 → v14)

- `translationModel`에서 provider 추론 (`claude*` → anthropic).
- `chatModel`과 provider가 엇갈리면 **`translationModel` 기준**으로 통일 (문서 작업이 주 용도).
- 기존 세션의 `model_preset`도 같은 규칙으로 변환.

---

## 6. 완료 기준

- [x] `npx tsc --noEmit` 통과
- [x] `npm run test:run` 통과 (1167 passed / 8 skipped)
- [x] `cargo test` — `model_preset` 라운드트립 포함 44/45 통과.
      `utils::tests::validate_path_allows_file_in_temp_dir` 1건은 샌드박스 TMPDIR 때문에
      실패하는 **기존 환경 이슈**이고 이 작업과 무관하다.
- [ ] 앱에서 provider를 바꿔도 검수만 Opus/Sol로 가고 폴리싱은 Sonnet/Luna로 가는지 확인 (수동)
- [ ] Settings › Usage에서 `feature=polish`의 `model`이 Sonnet 5로 찍히는지 확인 (수동)
- [x] **ADR 작성** — [ADR-0012](adr/0012-provider-only-model-selection.md)

### 구현하며 계획과 달라진 것

- **`resolveModelCallOptions`에서 `useFor` 인자 제거.** effort가 매핑에서 `cfg.reasoningEffort`로
  실려 오므로 용도 분기가 통째로 죽었다. 남은 판정은 "이 **모델**이 이 파라미터를 받는가"뿐이다.
  따라 `backendCompletion`의 `useFor` 파라미터도 제거(호출부는 `runReview.ts` 2곳).
- **`ModelRunConfig.requestedPreset` / `ChatMessageMetadata.requestedModelPreset` 새 쓰기 중단.**
  값이 `provider` 필드와 완전히 겹쳐 중복이 됐다. 메타데이터 필드는 과거 메시지 읽기용으로 유지하고,
  `ChatContent`의 `pendingModelChange`가 `requestedModelPreset ?? provider`를 `normalizeProvider`로
  통과시켜 비교한다 — 안 그러면 레거시 세션에서 "다음 응답부터 적용" 힌트가 상시 뜬다.
- **`normalizeProvider()` 신설** (계획에 없던 함수). 세션 pin·과거 메타데이터에 남은 프리셋 ID를
  읽는 지점마다 환산한다. 없으면 `MODEL_BY_USE['claude-sonnet-5']`처럼 undefined를 인덱싱한다.
- **`VITE_AI_MODEL` env 오버라이드 제거.** 먹이던 상태(`translationModel`/`chatModel`)가 사라졌다.
- **`client.ts`의 긴 출력 분기에 `polish` 추가** (`isLongOutput`). 폴리싱은 항상 명시적 maxTokens를
  넘기므로 현재는 무영향이지만, 빠뜨리면 채팅 상한(8192)으로 조용히 잘리는 함정이 남는다.
- **`summary`도 Responses API 경로 유지.** 기존에 `useFor: 'chat'`으로 돌던 호출이라
  `useFor: 'summary'`로 바꾸면서 API가 바뀌지 않도록 조건에 함께 넣었다.
- **`scripts/tauri-testing-mcp-workflow.mjs`** — 모델 라벨 3개(이미 죽은 `Opus 4.6`/`Sonnet 4.5`/
  `Haiku 4.5`)를 클릭하던 로직을 `Anthropic` 하나로 교체.
- **`.claude/skills/e2e-scenario/SKILL.md`의 `chat-model-select` 주석("모델 선택")은 못 고쳤다** —
  샌드박스가 그 경로 쓰기를 막는다. testid는 그대로라 동작에는 영향 없음.

---

## 7. 이번 범위 아님 (별도 항목으로 남김)

| 항목 | 내용 | 상태 |
|---|---|---|
| 사용량 실측 | Settings › Usage + 콘솔 `[AI cache]`로 캐시 read가 실제로 0보다 큰지 확인 | **미실시. 캐시 관련 판단의 전제** |
| `cacheSystem` 누락 | `polishDocument.ts:301`·`:354`, `retranslateSelection.ts:151`에 `cacheSystem: true` 추가. 선택 재번역은 입력 대부분이 system이라 회당 ~50% 절감 | 대기 |
| 툴 토글 위생 | 안 쓰는 웹/Confluence 토글 off, 세션 도중 변경 금지(캐시 전멸) | 운영 규칙, 코드 변경 없음 |
| OpenAI 캐시 정합성 | `prompt_cache_key` 전송, `cache_write_tokens` 파싱, `ai.rs:97` 주석 수정, `pricing.ts`에 OpenAI 캐시 단가 기입 | Anthropic만 쓰면 불필요 |
| 채팅 1h TTL | 턴 간격이 5분을 넘는 대화에서 유리. breakpoint 여유 1개 있음 | 검토 |
| 문서 블록 캐시 breakpoint | 재실행 대비 | 보류 |

### 폐기된 항목 (되살리자는 제안이 오면 여기를 먼저 확인할 것)

- **증분 검수**(변경 세그먼트만 재검수) — 절감폭은 가장 컸으나(재검수 70~90%) **검수는 매번 문서
  전체를 보는 것이 취지**라는 판단으로 폐기.
- **검수 effort 설정화** / **effort를 프리셋에서 분리** — effort를 high 고정하기로 결정하여 폐기.
- **모델 통일(채팅=번역)** — 근거였던 "캐시 1벌화"가 **오류**였다. 채팅/번역/검수/폴리싱은 system
  첫 줄부터 다르고 채팅에만 tools가 앞에 붙으므로, 같은 모델을 써도 기능 간 공유되는 캐시 엔트리는
  없다. 캐시는 전부 기능 내부(검수 청크 간, 채팅 턴 간, 번역 청크 간)에서만 발생한다.
