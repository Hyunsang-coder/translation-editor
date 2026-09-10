# Review Feature Audit

검수(Review) 기능 코드 리뷰 결과. 2026-02-09 기준.

## 대상 파일

| 파일 | 라인 | 역할 |
|------|------|------|
| `src/ai/review/runReview.ts` | 114 | 검수 전용 API 호출 (도구 없이 단순 1회) |
| `src/ai/review/parseReviewResult.ts` | 333 | AI 응답 → ReviewIssue[] 파싱 (3단계 폴백) |
| `src/ai/tools/reviewTool.ts` | 475 | 청킹, 프롬프트, LangChain 도구 정의 |
| `src/stores/reviewStore.ts` | 426 | Zustand 상태 + 캐시 + 액션 |
| `src/components/review/ReviewPanel.tsx` | 692 | 메인 UI + 청크 루프 + 재번역 |
| `src/components/review/ReviewResultsTable.tsx` | 336 | 이슈 테이블 + severity 필터 |
| `src/editor/extensions/ReviewHighlight.ts` | 235 | ProseMirror 데코레이션 (에디터 하이라이트) |
| `src/components/review/reviewApply.ts` | 32 | 세그먼트 ID 정규화 유틸 |
| `src/ai/review/parseReviewResult.test.ts` | 409 | 파싱 테스트 (20+ 케이스) |

**총 규모**: ~3,200줄

---

## 아키텍처 요약

```
ReviewPanel (UI)
  ↓ handleRunReview()
buildAlignedChunksAsync() → 12KB 단위 청킹
  ↓ for each chunk
runReview() → LangChain stream (도구 없이 직접)
  ↓ AI 응답
parseReviewResult() → ReviewIssue[]
  ↓
reviewStore.addResult() → highlightNonce++
  ↓
ReviewHighlight (ProseMirror plugin) → 에디터 데코레이션
ReviewResultsTable → severity 필터링 + 테이블 표시
```

**Two-Pass Review**: Pass 1(세그먼트별 검출, 과검출 허용) → Pass 2(오탐 제거, 최종 확정)

---

## 프롬프트 분석

### 구조 (reviewTool.ts:173-317)

```
buildReviewPrompt() = TWO_PASS_REVIEW_PROMPT
                    + REVIEW_DETECTION_PROMPT
                    + OUTPUT_FORMAT
```

- **TWO_PASS_REVIEW_PROMPT**: 방법론, Issue Types(5종), Severity(3단계), False Positive 기준
- **REVIEW_DETECTION_PROMPT**: "모든 이슈 검출" 지시 (Minor 포함)
- **OUTPUT_FORMAT**: `---REVIEW_START/END---` 마커, Markdown 형식, 예시 2개

### 사용자 메시지 구조 (runReview.ts:56-86)

```
## 번역 방향 (Source/Target 언어 + 경고)
## 번역 규칙 (있을 때만)
## 용어집 (있을 때만)
## 검수 대상 ([#N] Source/Target 쌍)
출력 형식 지시 + 응답 언어 지시 (앱 언어 설정 연동)
```

### 장점

1. Two-Pass 프레임으로 AI에게 "검출 → 필터링" 사고 순서 부여
2. False Positive 판정 기준이 구체적 (한국어 주어 생략, 문화적 적응 등)
3. Source/Target excerpt 혼동 방지 경고 (`runReview.ts:65-68`)
4. 마커 기반 출력으로 안정적 파싱 경계 확보

---

## 발견된 이슈 — 해결 완료

### ✅ #1 에러 감지 오탐 (P1) — `9b5fb7d`
마커 추출을 에러 감지보다 먼저 실행. 마커가 있으면 에러 감지 스킵.

### ✅ #2 Excerpt 따옴표 파싱 잘림 (P1) — `9b5fb7d`
Source/Target 정규식을 `[^"]*` → `(.*?)` + `$` 앵커로 변경.

### ✅ #3 maxTokens 응답 잘림 미감지 (P1) — `d429072`
START만 있고 END 없으면 START~끝까지 추출. 불완전한 이슈는 유효성 검증에서 자동 제외.

### ✅ #5 프로덕션 console.log (P2) — `9b5fb7d`
ReviewHighlight 7곳의 디버깅 console.log 제거 + 미사용 변수 정리.

### ✅ #8 프롬프트 언어 혼용 (P2) — `8a76754`
앱 UI 언어(ko/en)에 따라 Explanation 언어 지시. Suggestion은 Target 언어 고정.

### ✅ Severity 기준 명확화 + Minor 색상 — `ac2cf1f`
- Major: 명백한 문법 오류(단복수, 관사, 수일치, 시제) 기준 추가
- Minor: 판단이 어려운 뉘앙스 차이만으로 재정의
- Minor 태그 색상 gray → blue (선택/비선택 구분 강화)

---

## 보류 — 실무적 영향 낮음

### #4 segmentOrder 항상 0 (P1)
Markdown 파싱에서 `segmentOrder`가 항상 0. 이론적 ID 충돌 가능하나 동일 type+excerpt가 다른 세그먼트에 반복될 확률 극히 낮음. `segmentGroupId`가 이미 하이라이트 매칭에 사용 중.

### #6 Glossary 첫 청크만 검색 (P2)
4000자 기준 첫 청크만 glossary 검색. 후반부 용어 누락 가능하나 API 비용 증가 대비 효과 불확실.

### #7 severityFilter Set 타입 (P2)
`new Set()` 생성 시 Zustand shallow 비교 실패. 그러나 구독자 2곳뿐이고 사용자 클릭 시에만 발생하여 성능 영향 무시 가능.

### #9 handleRunReview deps에 project 객체 (P3)
`project` 객체 참조 변경 시 useCallback 재생성. 빈번하지 않아 영향 미미.

### #10 TranslatePreviewModal에 getState() 직접 호출 (P3)
렌더 함수 내 `getState()`로 React 반응성 우회. 의도적 스냅샷일 수 있음.

### #11 hashContent 32비트 해시 (P3)
djb2 해시 32비트. 이슈 수가 적어 충돌 확률 극히 낮음.

### #12 경과 시간 초기화 (P3)
`isReviewing` false 시 즉시 `setElapsedSeconds(0)`. UX 개선 수준.

### #13 테스트 커버리지 부분적 (P3)
`parseReviewResult`만 테스트 존재. `buildAlignedChunks`, `ReviewHighlight` 등 미커버.

---

## 잘 된 점 (유지)

1. **stale closure 방지** — 청크 루프 내 `useChatStore.getState()`
2. **파싱 에러 격리** — `parseReviewResult` try-catch로 청크별 격리
3. **3단계 폴백 파싱** — 마커 → Markdown → JSON, AI 응답 포맷 변동에 견고
4. **비동기 청킹** — `buildAlignedChunksAsync`로 UI 블로킹 방지
5. **AbortController 정리** — abort 후 즉시 null 설정, 메모리 누수 방지
6. **nonce 패턴** — `highlightNonce`로 에디터 새로고침 트리거 깔끔
7. **탭 전환 시 상태 보존** — `initializedProjectId` 체크로 불필요한 재초기화 방지
8. **세그먼트 범위 필터링** — 하이라이트 시 `segmentGroupId`로 오매칭 방지
9. **이미지 제거** — `stripImages()`로 토큰 절약 (청킹 단계에서)
10. **결정적 ID** — 중복 제거 + 체크 상태 유지에 활용
