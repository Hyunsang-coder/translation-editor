# ADR-0012: 모델 선택을 provider 하나로 줄이고, 용도별 모델·effort는 앱이 고정한다

- **Status**: Accepted — 일부 수정됨 ([ADR-0017](0017-model-override-for-evaluation.md), 2026-07-31)
- **Date**: 2026-07-30
- **관련**: [작업 계획](../provider-only-model-selection-plan.md), [ADR-0005](0005-fixed-context-snapshot-per-workflow.md)

> **ADR-0017이 아래 Consequences의 "사용자가 모델을 직접 고를 수 없다" 한 줄을 뒤집었다.**
> 평가 목적의 용도별 모델 지정이 Settings에 생겼다. 다만 이 ADR의 핵심 — 사용자가 고르는
> 값은 provider 하나이고 **기본값·effort·선택 가능 목록은 앱이 고정한다** — 는 그대로다.
> 기각한 대안 4건(증분 검수 / effort 차등화 / 채팅=번역 통일 / 폴리싱만 medium)도 유효하다.

## Context

**번역·검수·폴리싱이 모델 설정 하나(`translationModel`)를 공유하고 있었다.**
`config.ts`가 `useFor === 'translation' || useFor === 'review'`를 같은 저장값으로 해석했고,
폴리싱은 `getAiConfig({ useFor: 'translation' })`을 부르므로 여기에 함께 묶였다.

사용자는 "번역은 Sonnet, 검수는 Opus"를 원해 **작업 전마다 툴바 드롭다운을 손으로 바꾸고
있었다.** 검수용으로 Opus로 올린 뒤 되돌리는 것을 잊으면 폴리싱까지 Opus로 실행된다.
한국어 20,000자 문서 1사이클 기준 $1.44 → $1.69로, **드롭다운을 되돌렸는지에 15%가 걸려 있었다.**

부수적으로 프리셋 체계에는 조용한 fallback 함정이 있었다. 저장값이 목록에 없거나 해당
provider가 비활성이면 `presets[0]`(= Opus 5)로 말없이 교체된다(`config.ts`,
`ChatContent.tsx`, `WorkflowActions.tsx` 세 곳).

제약:

- `chat_sessions.model_preset` 컬럼에 세션별 선택이 이미 저장돼 있다. 세션 pin은
  캐시 수명과 직결돼 있어(첫 메시지 이후 잠금) 없앨 수 없다.
- 과거 메시지의 `ChatMessageMetadata.requestedModelPreset`에 프리셋 문자열이 남아 있다.
- `pricing.ts`의 `MODEL_PRICES`는 사용량 장부가 남긴 **API 모델 ID**로 조회된다.

### 검토한 대안과 버린 이유

- **용도별 모델을 각각 설정 항목으로 노출** — 문제는 정확히 그 설정이 너무 많아서 생겼다.
  항목을 3개로 늘리면 "폴리싱 설정을 안 되돌렸다"가 "폴리싱 설정을 안 바꿨다"로 바뀔 뿐이다.
- **effort를 용도별로 차등** — 폴리싱만 medium으로 내리는 안을 검토했으나 폐기했다.
  폴리싱 산출물은 곧 문서 본문이고, 하는 일이 어색한 collocation·표현 판단이라 effort
  의존도가 번역보다 높다. 절감폭도 작다(출력의 대부분이 thinking이 아니라 문서 본문이라
  사이클당 ~8%). 또 `retranslateSelection`이 `translation`(high)에 묶여 있어, 폴리싱만
  medium이면 **문단 하나 다듬을 때가 문서 전체를 다듬을 때보다 effort가 높아지는 역전**이
  생긴다. effort는 전부 high로 고정하고 요약만 medium으로 둔다.
- **모델 통일(채팅=번역)** — 근거였던 "캐시 1벌화"가 오류였다. 채팅/번역/검수/폴리싱은
  system 첫 줄부터 다르고 채팅에만 tools가 앞에 붙으므로, 같은 모델을 써도 기능 간
  공유되는 캐시 엔트리는 없다.
- **증분 검수**(변경 세그먼트만 재검수) — 절감폭은 가장 컸으나 **검수는 매번 문서 전체를
  보는 것이 취지**라는 판단으로 폐기.
- **`model_preset` 컬럼 rename** — 마이그레이션 비용 대비 실익이 없어 이름은 두고 값 의미만 바꿨다.

## Decision

사용자가 고르는 값은 **`provider: 'anthropic' | 'openai'` 하나**로 줄인다.
용도별 모델·effort는 `src/ai/config.ts`의 `MODEL_BY_USE` 매핑이 고정한다.

| 용도 (`ModelUseFor`) | Anthropic | OpenAI |
|---|---|---|
| `translation` (선택 재번역 포함) | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| `review` | `claude-opus-5` · high | `gpt-5.6-sol` · high |
| `polish` (신설) | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| `chat` | `claude-sonnet-5` · high | `gpt-5.6-luna` · high |
| `summary` (내부, 비노출) | `claude-sonnet-5` · **medium** | `gpt-5.6-luna` · **medium** |

> 표는 이 ADR 작성 시점(v13)의 값이다. 이 ADR이 고정하는 것은 **"사용자는 provider만 고르고
> 용도별 모델은 앱이 정한다"는 구조**이지 개별 모델 선택이 아니다 — 칸 안의 값은 단가·벤치마크가
> 바뀌면 따라 움직인다. 현재 값은 항상 `MODEL_BY_USE`가 진실이다.
> (2026-07-30 개편 후 OpenAI `review`는 `gpt-5.6-sol` → `gpt-5.6-terra`로 옮겼다.)

- `MODEL_PRESETS` / `resolveModelFromPreset` 폐기 → `resolveModelForUse(provider, useFor)`.
- **Haiku 4.5 완전 제거.** 요약이 Sonnet 5 · medium으로 옮겨가 남길 이유가 없다.
  단가표(`pricing.ts`)의 Haiku 항목은 과거 사용량 기록 조회용으로 남긴다.
- effort는 **명시적으로 전송한다.** Anthropic 기본값이 이미 high지만, 기본값이 바뀌어도
  흔들리지 않게 한다. `resolveModelCallOptions(cfg)`는 이제 `useFor`를 받지 않고
  "이 **모델**이 이 파라미터를 받는가"만 판정한다(`src/ai/modelCallOptions.ts`).
- **세션 pin은 provider 축으로 유지한다.** `chat_sessions.model_preset` 컬럼은 이름을
  두고 값만 `anthropic`/`openai`로 바꾼다. 첫 메시지 이후 잠금도 유지 — provider 축에서는
  API 자체가 바뀌므로 더 중요하다(`src/stores/chatStore.session.ts:setSessionModelPreset`).
- 저장된 레거시 프리셋 ID는 **읽는 지점에서** `normalizeProvider()`가 환산한다
  (`claude*` → anthropic, 그 외 → openai). 세션 hydrate가 그 결과를 되써서 고정한다.
- `aiConfigStore` **v13 → v14 마이그레이션**: `translationModel` 기준으로 provider를 추론하고
  `translationModel`/`chatModel`을 삭제한다. 두 값의 provider가 엇갈리면 문서 작업이 주
  용도이므로 `translationModel`을 살린다.
- `ModelRunConfig.requestedPreset`과 `ChatMessageMetadata.requestedModelPreset` 새 쓰기를
  중단한다 — 값이 `provider` 필드와 완전히 겹친다. 메타데이터 필드는 과거 메시지 읽기용으로 남긴다.

## Consequences

- **얻은 것**: 검수만 상위 모델로 가고 폴리싱은 절대 따라 올라가지 않는다. 되돌리는 것을
  잊을 드롭다운이 없어졌다. `presets[0]`로 조용히 튀는 fallback 세 곳이 함께 사라졌다.
  용도가 하나 늘어도 매핑 테이블 한 줄이라 번역·폴리싱이 다시 엮일 구조가 아니다.
- **잃은 것 / 감수하는 것**: 사용자가 모델을 직접 고를 수 없다. "이번만 싸게" 같은 임시
  다운그레이드가 불가능하고, 모델 교체는 코드 변경 + 배포가 된다. 채팅 저비용 옵션
  (Luna medium 프리셋)도 함께 사라진다.
- **따라오는 의무**:
  - 새 모델 도입은 `MODEL_BY_USE` 수정 + `MODEL_PRICES`에 단가 추가. 단가를 빠뜨리면
    `pricing.test.ts`의 커버리지 테스트가 잡는다.
  - v13 이전 세션·메시지를 읽는 새 코드는 반드시 `normalizeProvider()`를 통과시킬 것.
    provider가 아닌 문자열로 `MODEL_BY_USE`를 인덱싱하면 undefined를 만진다.
  - `MODEL_BY_USE`에서 모델을 빼도 `MODEL_PRICES`에서는 빼지 말 것(과거 장부 조회).
