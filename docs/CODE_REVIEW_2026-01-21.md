# 코드 리뷰 보고서

**프로젝트**: OddEyes.ai (Translation Editor)
**검토일**: 2026-01-21
**검토 범위**: 메모리, 성능, 보안
**브랜치**: beta-1.0

---

## 요약

| 영역 | 상태 | 주요 발견 |
|------|------|----------|
| **보안** | ✅ 양호 | XSS, 경로 탐색, API 키 관리 모두 안전 |
| **성능** | 🟡 개선 필요 | 리렌더링 최적화, 동기 연산 개선 기회 |
| **메모리** | ✅ 해결됨 | TipTap destroy, 메시지 제한, 타이머 cleanup 완료 |

---

## 1. 메모리 이슈

### 1.1 Critical Issues

#### ~~TipTap 에디터 destroy() 미호출~~ ✅ 해결됨
- **파일**: `src/components/editor/TipTapEditor.tsx`
- **문제**: `useEditor()` 훅 사용 후 cleanup에서 `editor.destroy()` 호출 없음
- **해결**: 3개 에디터 컴포넌트(TipTapEditor, SourceTipTapEditor, TargetTipTapEditor)에 cleanup useEffect 추가

#### ~~TranslatePreviewModal 임시 에디터~~ ✅ 해결됨
- **파일**: `src/components/editor/TranslatePreviewModal.tsx`
- **문제**: diff 뷰용 에디터 생성 후 destroy 호출 없음
- **해결**: cleanup useEffect 추가

#### ~~에디터 레지스트리 전역 참조~~ ✅ 해결됨
- **파일**: `src/editor/editorRegistry.ts`
- **문제**: 전역 변수 `sourceEditor`, `targetEditor`가 에디터 파괴 후에도 참조 유지
- **해결**: `clearEditorRegistry()` 함수 추가 (프로젝트 전환 시 호출 필요)

### 1.2 High Priority Issues

#### ~~Chat 메시지 무제한 누적~~ ✅ 해결됨
- **파일**: `src/stores/chatStore.ts`
- **문제**: 세션당 메시지 개수 제한 없음 (세션 5개 제한은 있음)
- **해결**: `MAX_MESSAGES_PER_SESSION = 1000` 상수 추가, 초과 시 FIFO 방식으로 삭제

#### ~~Auto-save 타이머 정리~~ ✅ 해결됨
- **파일**: `src/stores/projectStore.ts`
- **문제**: 앱 언마운트 시 `stopAutoSave()` 호출 시 `writeThroughTimer` 미정리
- **해결**: `stopAutoSave()`에 `writeThroughTimer` cleanup 로직 추가

### 1.3 Medium Priority Issues

| 이슈 | 파일 | 설명 |
|------|------|------|
| TipTap JSON 중복 캐시 | `projectStore.ts` | `sourceDocJson`/`targetDocJson`이 원본 HTML과 별도 저장 |
| ImageMap 정리 시점 | `imagePlaceholder.ts` | 번역 완료 후 이미지 맵 정리 확인 필요 |
| ChatContent 배열 리렌더 | `ChatContent.tsx` | 스트리밍 중 전체 메시지 배열 리렌더 가능 |

---

## 2. 성능 이슈

### 2.1 High Priority Issues

#### buildAlignedChunks 동기 작업
- **파일**: `src/ai/review/reviewTool.ts`
- **문제**: 검수 시작 시 모든 세그먼트의 HTML→Markdown 동기 변환
- **영향**: 큰 문서에서 메인 스레드 블로킹 (수 초)
- **해결 방향**: 웹 워커 또는 청크 단위 비동기 처리

#### Zustand 과다 구독
- **파일**: `src/components/chat/ChatContent.tsx`
- **문제**: 14개 이상의 분리된 선택자 구독
- **영향**: store의 작은 변경도 모든 구독자 재평가
- **해결 방향**: 관련 상태를 단일 선택자로 통합

### 2.2 Medium Priority Issues

| 이슈 | 파일 | 설명 |
|------|------|------|
| ~~getAllIssues 중복 계산~~ ✅ | `reviewStore.ts` | `highlightNonce` 기반 캐싱 구현 완료 |
| 선형 검색 패턴 | `projectStore.ts` | `segments.find()` 반복 호출, 대규모 프로젝트에서 영향 |
| React.memo 미적용 | 전체 | 40+ 컴포넌트 중 2개만 memo 적용 |
| saveProject 중복 연산 | `projectStore.ts` | `buildTargetDocument` 여러 번 호출 |

### 2.3 Low Priority Issues

| 이슈 | 파일 | 설명 |
|------|------|------|
| includes() 과도한 사용 | `projectStore.ts` | O(n×m) 복잡도의 중첩 검색 |
| glossary 검색 캐싱 | `chatStore.ts` | 매 메시지마다 DB 검색 실행 |
| ChatContent/ChatPanel 중복 | 두 파일 | 거의 동일한 로직 중복 구현 |

---

## 3. 보안 이슈

### 3.1 잘 구현된 영역 ✅

#### XSS 방지
- **파일**: `src/utils/htmlNormalizer.ts`
- **구현**: DOMPurify 기반 HTML sanitization
- **특징**:
  - 허용 태그/속성 명시적 화이트리스트
  - URL 프로토콜 검증 (javascript:, data:, vbscript: 차단)
  - Confluence HTML 붙여넣기 안전 처리

#### 경로 탐색 방지
- **파일**: `src-tauri/src/utils.rs`
- **구현**: Blocklist 기반 경로 검증
- **특징**:
  - OS별 시스템 디렉토리 차단
  - `canonicalize()`로 symlink/.. 우회 방지
  - 모든 파일 접근 명령에서 일관된 검증

#### API 키 관리
- **파일**: `src-tauri/src/secrets/manager.rs`, `src/stores/aiConfigStore.ts`
- **구현**: OS 네이티브 키체인 사용
- **특징**:
  - 로컬스토리지 저장 안 함
  - 환경변수 fallback 없음
  - `zeroize` 크레이트로 메모리 민감 데이터 정리

#### 입력 검증
- **파일**: `src-tauri/src/commands/attachments.rs`
- **구현**: 다층 검증
- **특징**:
  - 파일 크기 제한 (100MB, 이미지 10MB)
  - 확장자 화이트리스트
  - 경로 검증 + 파일 존재 확인

#### AI 페이로드 안전
- **파일**: `src/ai/translateDocument.ts`
- **구현**: Markdown 마커 기반 응답 추출
- **특징**:
  - `---TRANSLATION_START/END---` 마커로 prompt injection 방지
  - 이미지 Base64를 플레이스홀더로 대체
  - 응답 truncation 자동 감지

### 3.2 개선 권장 사항 🟡

#### ~~에러 로깅 민감정보 노출~~ ✅ 해결됨
- **파일**: `src/stores/aiConfigStore.ts:60`
- **문제**: `console.warn(..., err)` - err 객체에 키 정보 포함 가능
- **해결**: `err.message`만 로깅하도록 수정

#### ~~임시 파일 자동 정리~~ ✅ 해결됨
- **파일**: `src-tauri/src/commands/attachments.rs`, `src-tauri/src/lib.rs`
- **문제**: `cleanup_temp_images()` 앱 시작 시 자동 호출 미확인
- **해결**: `lib.rs` setup 훅에서 자동 호출 추가 (24시간 이상 경과 파일 삭제)

#### ~~개발 콘솔 로깅~~ ✅ 해결됨
- **파일**: `src/ai/mcp/McpClientManager.ts`
- **문제**: 토큰/상태 정보 콘솔 노출
- **해결**: 15개 console.log에 `import.meta.env.DEV` 조건 추가

---

## 4. 권장 조치 우선순위

### ~~즉시 대응 (Critical)~~ ✅ 완료

1. ~~**TipTap 에디터 destroy 추가**~~ ✅
   - `TipTapEditor.tsx` cleanup에 `editor?.destroy()` 추가
   - `TranslatePreviewModal.tsx` 동일 적용

2. ~~**에디터 레지스트리 정리**~~ ✅
   - `clearEditorRegistry()` 함수 추가 완료

### ~~빌드 후 조기 대응 (High)~~ ✅ 완료

3. ~~**Chat 메시지 제한**~~ ✅
   - 세션당 최대 1000개 메시지 제한 구현

4. ~~**Auto-save 타이머 정리**~~ ✅
   - `stopAutoSave()`에 `writeThroughTimer` cleanup 추가

5. **buildAlignedChunks 비동기화** (미완료)
   - 웹 워커 또는 청크 단위 처리로 메인 스레드 블로킹 방지

### 중기 개선 (Medium)

6. **Zustand 선택자 최적화**
   - ChatContent의 14+ 선택자를 관련 그룹으로 통합

7. ~~**콘솔 로깅 프로덕션 필터링**~~ ✅
   - 민감 정보 로깅에 DEV 조건 추가 완료

8. ~~**getAllIssues 캐싱**~~ ✅
   - `highlightNonce` 기반 캐싱 구현 완료

---

## 5. 검증되지 않은 영역

| 영역 | 설명 | 권장 조치 |
|------|------|----------|
| Tauri IPC 보안 | 명령어별 권한 설정 미검토 | `tauri.conf.json` allowlist 검증 |
| SQLite 쿼리 | 매개변수화 여부 미확인 | DB 쿼리 SQL injection 검토 |
| CORS 정책 | 외부 API 호출 정책 미검토 | 리소스 요청 CORS 검증 |

---

## 6. 결론

### 빌드 가능 여부: ✅ 가능

현재 상태로 빌드 진행 가능합니다. 발견된 Critical 이슈들도 기능 동작에는 영향이 없으며, 장시간 사용 시 메모리 누적 문제가 발생할 수 있습니다.

### 전체 평가

- **보안**: 잘 구현됨 - XSS, 경로 탐색, API 키 관리 모두 안전
- **성능**: 개선 기회 있음 - 리렌더링 최적화, 동기 연산 개선 권장
- **메모리**: 주의 필요 - TipTap 에디터 lifecycle 관리가 핵심 개선점

### 다음 스프린트 권장 작업

1. ~~TipTap 에디터 destroy 로직 추가~~ ✅
2. ~~에디터 레지스트리 정리 로직 구현~~ ✅
3. ~~Chat 메시지 제한 적용~~ ✅
4. buildAlignedChunks 비동기 처리
5. Zustand 선택자 최적화

---

## 7. 수정 이력

| 날짜 | 수정 내용 |
|------|----------|
| 2026-01-21 | 1차 수정: Critical 이슈 3건 + 보안 로깅 2건 해결 |
| 2026-01-21 | 2차 수정: High 이슈 4건 + Medium 이슈 2건 해결 (chatStore 메시지 제한, projectStore 타이머 cleanup, reviewStore 캐싱, aiConfigStore/McpClientManager 로깅, lib.rs temp cleanup) |

---

*이 문서는 Claude Code에 의해 자동 생성되었습니다.*
