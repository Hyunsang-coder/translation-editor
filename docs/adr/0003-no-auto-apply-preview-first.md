# ADR-0003: AI는 문서를 직접 수정하지 않는다 (Preview → Apply)

- **Status**: Accepted
- **Date**: 2026-01-22 (소급 기록 2026-07-29)
- **관련**: `src/stores/translationPreviewStore.ts`, `src/components/editor/TranslatePreviewModal.tsx`

## Context

이 도구의 사용자는 번역가이고, 결과물의 책임도 번역가에게 있습니다. AI가 문서를 자동으로 고치면 두 가지가 무너집니다.

- **검토 부담의 역전** — 사용자가 "AI가 뭘 바꿨는지"를 사후에 찾아내야 합니다. 긴 문서에서는 실질적으로 불가능합니다.
- **신뢰의 비가역성** — 자동 적용이 한 번 문서를 망치면, 이후 사용자는 AI 기능 전체를 끕니다. 정확도를 아무리 올려도 회복되지 않습니다.

반대편 압력도 실재했습니다. 확인 단계가 매번 끼면 반복 작업이 느려지고, "다 맞는데 왜 매번 눌러야 하나"라는 마찰이 생깁니다. 특히 부분 수정처럼 범위가 작고 명백한 경우에 그렇습니다.

## Decision

**AI 산출물이 문서에 닿는 모든 경로는 Preview → 사용자 확인 → Apply를 거친다.** 예외 없음 — 범위가 작다는 이유로 우회하지 않는다.

- 전체 번역·검수·폴리싱: `translationPreviewStore` → `TranslatePreviewModal`에서 확인 후 적용
- 부분 수정: 직접 재번역과 채팅의 `propose_selection_edit` 둘 다 공통 preview를 거치고, 적용 직전 **anchor / project / text guard**를 통과해야 함 (문서가 그 사이 바뀌었으면 stale 처리)
- 외부 반입(Desktop MCP): 외부 Claude도 문서에 직접 쓰지 못하고 preview 스토어를 경유 — `oddeyes_set_translation_preview` → `oddeyes_apply_translation_preview`
- 지식 갱신도 같은 원칙: 채팅이 제안한 Project Memory·금칙어·용어집 항목은 `proposed` 상태로 들어가고 사용자가 승인해야 `active`가 됨 ([ADR-0004](0004-approval-based-project-memory.md))

## Consequences

- **얻은 것**: 사용자가 문서의 유일한 저자로 남습니다. AI 정확도가 떨어져도 실패는 "제안이 별로였다"에서 멈추고 문서에 도달하지 않습니다.
- **잃은 것 / 감수하는 것**: 모든 쓰기 경로에 preview 계약이 붙습니다. 문서를 고치는 기능을 하나 추가할 때마다 preview·guard·적용 3단을 다 만들어야 하며, 실제로 부분 수정 경로에서 이 비용이 컸습니다. "자동 적용" 요청이 들어와도 받지 않습니다.
- **따라오는 의무**: 새 AI 도구를 tool registry에 추가할 때, 문서를 바꾸는 효과가 있으면 반드시 제안 형태여야 합니다. 도구가 문서를 직접 쓰는 순간 이 ADR은 무효가 되고, 되돌리려면 그 도구를 쓰는 모든 대화 이력이 이미 문서를 오염시킨 뒤입니다.
