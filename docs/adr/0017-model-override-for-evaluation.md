# ADR-0017: 용도별 모델을 직접 지정할 수 있게 한다 (평가 목적, ADR-0012 부분 수정)

- **Status**: Accepted
- **Date**: 2026-07-31
- **관련**: [ADR-0012](0012-provider-only-model-selection.md) — 이 ADR이 그 Consequences 한 줄을 뒤집는다

## Context

[ADR-0012](0012-provider-only-model-selection.md)는 "사용자가 모델을 직접 고를 수 없다"를
**감수하는 비용**으로 명시하고, "용도별 모델을 각각 설정 항목으로 노출"을 첫 번째 대안으로
기각했다. 근거는 이랬다 — 항목을 3개로 늘리면 "폴리싱 설정을 안 되돌렸다"가 "폴리싱 설정을
안 바꿨다"로 바뀔 뿐이다.

그 판단은 **작업마다 드롭다운을 바꾸는 운영 워크플로**를 전제로 한 것이었다. 하루 뒤
(2026-07-30 OpenAI 가격 개편, [ADR-0012 표 각주](0012-provider-only-model-selection.md) 참조)
성격이 다른 요구가 생겼다: **어떤 모델이 이 번역 작업에 실제로 맞는지 직접 써 보고 판단**하고
싶다는 것. 한 번 정해서 며칠 유지하고, 결론이 나면 `MODEL_BY_USE`에 박고 UI는 닫아도 되는
용도다. 매 작업 전환이 아니다.

ADR-0012 때는 없던 근거가 하나 생겼다. 사용량 장부(`ai_usage_records`)가 기능별 실제 모델과
토큰을 남기고 있어서, Settings › Usage에서 "검수를 Opus로 한 주 / Sonnet으로 한 주"의 비용과
토큰이 **실측으로 비교된다.** 체감에 숫자가 붙는다.

동시에 판단 근거 자체가 흔들리는 국면이기도 하다 — Luna의 long-context recall 절벽(MRCR
256K–512K 41.3 대 Sol 91.5)처럼 벤치마크로만 알던 특성이 실제 번역 품질에 어떻게 나타나는지는
써 봐야 안다.

### 검토한 대안과 버린 이유

- **개발자 전용(.env / 숨은 플래그)** — 앱을 다시 띄우거나 파일을 고쳐야 해서 "실사용하며 체감"이
  안 된다. 며칠 단위로 유지하며 비교하는 것이 목적이라 in-app 설정이어야 했다.
- **작업/세션 단위 임시 지정** — ADR-0012가 죽인 그 물건이다. 되돌리는 것을 잊는 실패가 그대로
  돌아온다.
- **effort에 `xhigh`/`max`까지 열기** — `maxTokens` 예산은 **thinking을 포함**하는데(gotchas #150)
  지금 값이 전부 `high` 기준이다. 검수(16,384)·선택 재번역(16,384)은 마커 워크플로라
  reasoning이 예산을 먼저 먹으면 `---X_END---` 전에 잘려 **파싱이 실패한다.** 올리려면 예산도
  함께 올려야 하므로, 선택지를 `medium`/`high`로 제한했다. ADR-0012가 기각한 "폴리싱 기본값을
  medium으로"는 여전히 유효하다 — 여기서 여는 것은 **기본값이 아니라 평가용 손잡이**다.
- **모델 ID 자유 입력** — `resolveModelCallOptions`가 모델 ID prefix로 파라미터 지원을 판정하므로
  (`gpt-5*`, `claude-opus-4-7+`/`sonnet-5`) 목록 밖 모델은 400을 낸다. 단가가 없으면 사용량
  화면이 "가격 미상"으로 빠져 **비교라는 목적 자체가 무너진다.**
- **채팅 지정을 즉시 반영** — 진행 중 대화의 모델이 바뀌면 프롬프트 캐시 프리픽스가 통째로
  깨지고, effort가 바뀌면 messages 구간이 깨진다. ADR-0012가 세션 pin을 첫 메시지 이후 잠근
  이유와 같다. 모델만 스냅샷하고 effort는 즉시 반영하는 절충도 검토했으나, 같은 행의 두 칸이
  서로 다른 시점에 적용되는 UI는 설명할 수 없어 버렸다.

## Decision

`MODEL_BY_USE`는 **기본값으로 유지**하고, 그 위에 사용자 지정 레이어를 얹는다.

- `MODEL_CHOICES`(`src/ai/config.ts`)가 provider별 선택 가능 모델을 큐레이트한다.
  Anthropic: Opus 5 / Sonnet 5 / Haiku 4.5, OpenAI: Sol / Terra / Luna.
  목록의 모든 모델에 단가가 있는지, 기본값이 목록에 포함되는지는 `pricing.test.ts`가 검사한다.
- `resolveModelForUse(provider, useFor, overrides?)`가 모델·effort를 **각각 독립적으로**
  갈아끼운다. 한쪽만 지정하면 다른 쪽은 `MODEL_BY_USE`가 계속 고정한다.
- effort 선택지는 `EFFORT_CHOICES = ['medium', 'high']`. `xhigh`/`max`는 위 사유로 제외했다.
  effort를 받지 않는 모델(Haiku 4.5)에서는 UI가 선택을 막는다 — 판정은
  `modelSupportsEffort()` 한 곳이며, 호출 시 가드(`resolveModelCallOptions`)와 같은 함수를 쓴다.
- 지정값은 `aiConfigStore.modelOverrides`에 **provider × 용도 × {model, effort}**로 저장한다
  (v14 → v15 → v16). provider별로 따로 남으므로 provider를 오갈 때 다시 고를 필요가 없다.
  **지정한 칸만 담는다** — 기본값을 복사해 두면 앱이 모델을 바꿔도 기존 사용자만 옛 값에 고정된다.
- 목록에 없는 값은 조용히 무시하고 **앱이 고정한 기본값**으로 떨어진다. ADR-0012가 없앤
  `presets[0]` fallback과 달리 "모르는 모델로 튀는" 경로가 없다.
- **채팅은 세션 생성 시점에 모델을 굳힌다.** `chat_sessions.model_preset` 값이
  `provider[#model[#effort]]` 형태를 갖는다(컬럼은 그대로). effort만 지정한 세션은
  `anthropic##medium`처럼 모델 구간이 빈다. `normalizeProvider`가 구분자 뒤를 잘라내고,
  `pinnedChatSpec`이 스냅샷을 읽는다.
  **pin이 있으면 그 pin이 유일한 권위다** — 스냅샷이 없는 pin은 "지정 없이 시작한 세션"이라는
  뜻이므로 현재 지정이 아니라 기본값으로 간다. 여기서 현재 지정으로 떨어지면 이 기능을 켜는
  순간 존재하던 **모든 세션**이 다음 턴에 모델을 갈아타 캐시 프리픽스를 버린다.
  대가로, 이미 열어 둔 빈 대화는 새로 지정해도 반영되지 않는다 — "새 대화"를 눌러야 한다.
- UI(`ModelOverridesSection`)는 앱 설정의 `CollapsibleSection`을 쓴다. **지정이 있으면 모달을
  열 때 펼쳐지고(`defaultOpen`), 접어 두더라도 헤더 `summary`에 `● N개 지정됨`이 남는다.**
  전체 초기화는 본문 안에 두어 무엇을 지우는지 보고 나서 지우게 한다. 되돌리는 것을 잊게
  두지 않는 것이 이 기능의 전제 조건이며, 그 조건을 깨지 않는 한 표현 방식은 바뀔 수 있다.

## Consequences

- **얻은 것**: 코드 변경·배포 없이 모델을 바꿔 실사용으로 비교할 수 있다. 사용량 장부가 기능별
  모델을 이미 남기므로 비교가 실측으로 닫힌다.
- **잃은 것 / 감수하는 것**: ADR-0012가 없앤 "설정이 많아서 생기는 실패"가 부분적으로 돌아온다.
  배지·자동 펼침·원클릭 초기화가 그 방어책이고, 이게 무력하다는 것이 관측되면 이 ADR을 되돌린다.
  effort와 모델 목록은 여전히 앱이 고정하므로 ADR-0012의 핵심 구조는 유지된다.
- **따라오는 의무**:
  - `MODEL_CHOICES`에 모델을 추가하면 `MODEL_PRICES`에 단가도 넣을 것(테스트가 잡는다).
  - `MODEL_BY_USE`의 기본 모델은 반드시 `MODEL_CHOICES`에 있어야 한다(테스트가 잡는다).
  - 세션 pin을 읽는 새 코드는 `normalizeProvider`/`pinnedChatSpec`을 통과시킬 것.
    pin 문자열을 provider로 단정하고 비교하면 스냅샷이 붙은 세션을 매번 "바뀐 것"으로 본다.
  - `EFFORT_CHOICES`를 넓히려면 **먼저** 마커 워크플로의 `maxTokens`를 올릴 것
    (검수 `REVIEW_MAX_TOKENS`, 선택 재번역 `SELECTION_EDIT_MAX_TOKENS`, 채팅·요약).
  - **평가가 끝나면 결론을 `MODEL_BY_USE`에 반영하고 지정을 비울 것.** 이 기능은 판단을
    돕는 장치지 판단의 저장소가 아니다.
