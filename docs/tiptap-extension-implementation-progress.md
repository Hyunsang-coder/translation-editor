# TipTap Extension 구현 진행 상황

> 시작일: 2025-01-13
> 기반 문서: `docs/tiptap-extension-improvement-plan.md`

---

## Phase 1: Extension 기반 작업 ✅ 완료

### 1.1 패키지 설치 ✅
- [x] 5개 TipTap extension 패키지 설치
- 버전: `@tiptap/extension-*@^2.27.0` (프로젝트 TipTap 버전과 호환)
- 명령어: `npm install @tiptap/extension-underline@^2.27.0 @tiptap/extension-highlight@^2.27.0 @tiptap/extension-subscript@^2.27.0 @tiptap/extension-superscript@^2.27.0 @tiptap/extension-image@^2.27.0`

### 1.2 TipTapEditor.tsx 수정 ✅
- [x] 3개 에디터 컴포넌트에 5개 extension 추가
- 파일: `src/components/editor/TipTapEditor.tsx`
- 적용 대상: TipTapEditor, SourceTipTapEditor, TargetTipTapEditor

### 1.3 tipTapText.ts 수정 ✅
- [x] Table(4개) + Image extension 추가
- 파일: `src/utils/tipTapText.ts`
- 비고: 기존 Table 누락 버그 수정 완료

### 1.4 markdownConverter.ts 수정 ✅
- [x] Image extension 추가
- 파일: `src/utils/markdownConverter.ts`

---

## Phase 2: 이미지 플레이스홀더 시스템 ✅ 완료

### 2.1 imagePlaceholder.ts 생성 ✅
- [x] extractImages() 함수 구현
- [x] restoreImages() 함수 구현
- [x] getImageInfo() 함수 구현 (디버깅용)
- [x] estimateTokenSavings() 함수 구현
- 파일: `src/utils/imagePlaceholder.ts`

### 2.2 translateDocument.ts 통합 ✅
- [x] translateSourceDocToTargetDocJson() 함수에 이미지 플레이스홀더 로직 통합
- [x] translateWithStreaming() 함수에 이미지 플레이스홀더 로직 통합
- 파일: `src/ai/translateDocument.ts`

---

## Phase 3: HTML 정규화 (선택적)

### 3.1 htmlNormalizer.ts 생성
- [ ] DOMPurify 기반 정규화 유틸리티
- 상태: 미구현 (향후 필요 시 추가)

### 3.2 Source 에디터 연동
- [ ] 붙여넣기 핸들러 연동
- 상태: 미구현 (향후 필요 시 추가)

---

## 빌드 검증 ✅

- `npm run build` 성공
- 타입 오류 없음

---

## 변경 로그

| 일시 | 작업 | 상태 |
|------|------|------|
| 2025-01-13 | 구현 시작, 진행 상황 문서 생성 | 완료 |
| 2025-01-13 | Phase 1 완료 (패키지 설치 + 4개 파일 수정) | 완료 |
| 2025-01-13 | Phase 2 완료 (imagePlaceholder.ts 생성 + translateDocument.ts 통합) | 완료 |
| 2025-01-13 | 빌드 검증 완료 | 완료 |
| 2025-01-13 | Issue 1 수정 - TranslatePreviewModal.tsx extensions 추가 | 완료 |
| 2025-01-13 | Issue 2 분석 - Confluence 테이블 헤더 중복 (Phase 3로 해결 예정) | 분석 완료 |

---

## 수정된 파일 요약

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `package.json` | 수정 | 5개 extension 의존성 추가 |
| `src/components/editor/TipTapEditor.tsx` | 수정 | 3개 에디터에 5개 extension 등록 |
| `src/utils/markdownConverter.ts` | 수정 | Image extension 추가 |
| `src/utils/tipTapText.ts` | 수정 | Table(4개) + Image extension 추가 |
| `src/ai/translateDocument.ts` | 수정 | 이미지 플레이스홀더 로직 통합 |
| `src/utils/imagePlaceholder.ts` | **신규** | 이미지 추출/복원 유틸리티 |
| `src/components/editor/TranslatePreviewModal.tsx` | 수정 | extensions에 누락된 extension 추가 (Issue 1 수정) |

---

## 발견된 이슈

### Issue 1: 스트리밍 번역 후 최종 화면 블랭크
- **증상**: 번역 시 실시간 스트리밍은 정상 작동하지만, 최종 화면에서 내용이 표시되지 않음 (빈 화면)
- **상태**: 🟡 원인 파악됨 → 수정 필요
- **원인**: `TranslatePreviewModal.tsx`의 `extensions` 배열에 새로 추가한 extension이 누락됨
  - 184-192행: StarterKit, Link만 포함
  - 누락: Image, Table(4개), Underline, Highlight, Subscript, Superscript
- **해결 방법**: TranslatePreviewModal의 extensions에 누락된 extension 추가

### Issue 2: Confluence 테이블 붙여넣기 시 헤더 중복
- **증상**: Confluence 페이지에서 테이블 복사 → 붙여넣기 시 헤더 행이 두 번 표시됨
- **상태**: 🟡 원인 추정됨 → Phase 3 htmlNormalizer로 해결 가능
- **스크린샷**: 첫 번째 행 "Name of LoL Arena-mode buff | Buff effect"가 테이블 외부 + 테이블 내부에 모두 존재
- **추정 원인**:
  - Confluence HTML이 테이블 외부에 캡션/헤더 텍스트를 `<p>` 또는 `<div>`로 별도 포함
  - TipTap이 테이블 외부 텍스트와 `<thead>` 내용을 모두 파싱하여 중복 발생
- **해결 방안**:
  - Phase 3 htmlNormalizer.ts에서 테이블 직전 중복 텍스트 제거 로직 구현
  - 또는 TipTap의 paste 핸들러에서 Confluence 특화 정규화

---

## 다음 세션에서 이어받기

이 구현은 Phase 1, 2가 완료되었습니다. Phase 3 (HTML 정규화)는 선택적이며, 실제 웹 HTML 붙여넣기 테스트 후 필요 시 구현합니다.

테스트 방법:
1. `npm run tauri:dev` 실행
2. 이미지가 포함된 웹페이지에서 콘텐츠 복사 → Source 에디터에 붙여넣기
3. 번역 실행 → 콘솔에서 토큰 절약 로그 확인
4. 번역 결과에서 이미지가 올바르게 복원되는지 확인
