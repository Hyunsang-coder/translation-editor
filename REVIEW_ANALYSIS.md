# Translation/Review/Chat Logic Audit

요청에 따라 코드 수정 없이 잠재적 버그 및 리스크만 정리했습니다.

## Findings

- [x] **High**: 리뷰 취소가 실제 요청을 중단하지 않습니다. `AbortController`는 생성/체크하지만 `streamAssistantReply`에 `abortSignal`을 전달하지 않아, 취소/닫기 후에도 응답이 들어와 `addResult`가 실행될 수 있습니다. (`src/components/review/ReviewPanel.tsx:102`, `src/components/review/ReviewPanel.tsx:129`, `src/components/review/ReviewPanel.tsx:174`)
  - ✅ **Fixed**: `streamAssistantReply` 호출 시 `abortSignal: controller.signal` 전달하도록 수정
- [x] **High**: `review_translation`과 `get_review_chunk`의 청킹 기준이 불일치합니다. 첫 호출은 `maxChars`(기본 12000)로 청킹하고, 후속은 기본 10000으로 재청킹해서 청크 인덱스/세그먼트가 어긋날 수 있습니다. (`src/ai/tools/reviewTool.ts:183`, `src/ai/tools/reviewTool.ts:296`)
  - ✅ **Fixed**: `DEFAULT_REVIEW_CHUNK_SIZE` 상수(12000)를 도입하여 `buildAlignedChunks` 기본값 통일
- [x] **Medium**: JSON 파싱에서 `segmentOrder`가 문자열("1")이면 0으로 처리되어 ID 충돌/정렬 오류가 발생할 수 있습니다. (`src/ai/review/parseReviewResult.ts:54`)
  - ✅ **Fixed**: 문자열 타입도 `parseInt`로 변환하도록 수정
- [x] **Medium**: JSON 추출 정규식이 greedy라서 응답에 여분의 `{}`가 있으면 파싱 실패 → 마크다운 폴백(대부분 빈 결과)로 이어질 수 있습니다. (`src/ai/review/parseReviewResult.ts:45`)
  - ✅ **Fixed**: greedy 정규식 대신 중괄호 카운팅(`extractJsonObject`)으로 정확한 JSON 범위 추출
- [x] **Medium**: 하이라이트가 첫 번째 `indexOf` 매치만 사용합니다. 짧은 발췌가 여러 위치에 있거나 노드 경계를 넘으면 잘못된 위치를 강조하거나 누락될 수 있습니다. (`src/editor/extensions/ReviewHighlight.ts:31`)
  - ✅ **Fixed**: `buildTextWithPositions`로 전체 텍스트/위치 매핑 구축, 노드 경계를 넘는 텍스트도 검색 가능
- [x] **Medium**: 채팅에서 `/web` 검색 또는 translate 요청 경로는 기존 스트리밍 요청을 abort하지 않습니다. 동시 요청으로 `statusMessage`/`streamingContent`가 섞일 위험이 있습니다. (`src/stores/chatStore.ts:596`, `src/stores/chatStore.ts:615`)
  - ✅ **Fixed**: translate 및 web search 경로 시작 시 기존 `abortController.abort()` 호출 추가
- **Low**: 검수 항목을 전부 해제해도 리뷰 실행을 막지 않습니다. 경고 문자열을 그대로 프롬프트로 보내 JSON 형식이 깨지고 “이슈 없음”으로 보일 수 있습니다. (`src/ai/tools/reviewTool.ts:139`, `src/components/review/ReviewPanel.tsx:109`)
- **Low**: 세션 최대치 상태에서 `currentSession`이 null이면 `createSession()`이 상태를 갱신하지 않아 `addMessage`가 null을 반환할 수 있습니다(상태 불일치 시 메시지 유실). (`src/stores/chatStore.ts:479`, `src/stores/chatStore.ts:585`)

