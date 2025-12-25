# Phase 4: 전문 기능 (용어집 & Context Memory)

**목표**: 용어집 검색, Smart Context Memory 구현.

## 완료(요약)

- [x] CSV/Excel 용어집 임포트 (Tauri command)
- [x] 텍스트 기반 검색(부분 매칭)
- [x] Active Memory 요약을 모델 호출 payload에 주입
- [x] Add to Rules / Add to Memory 버튼
- [x] 첨부 파일: csv, xlsx 지원

## 미완료(상세)

### 4.2 첨부 파일 확장 (Claude 앱 방식)

**처리 원칙**: 모든 첨부 파일을 구조화된 텍스트로 변환하여 프롬프트에 포함

#### 4.2.1 지원 파일 타입 및 텍스트 추출 방식

- [ ] **PDF (.pdf)**
  - 추출 방식: 텍스트 레이어 추출 (pdfium 또는 poppler 사용)
  - 출력 포맷: 페이지별 구조화 텍스트
    ```
    [PDF: filename.pdf]
    Page 1:
    <extracted text>
    
    Page 2:
    <extracted text>
    ```
  - Rust 구현: `pdf-extract` 또는 `lopdf` 크레이트

- [ ] **PowerPoint (.pptx)**
  - 추출 방식: XML 파싱하여 슬라이드별 텍스트/노트 추출
  - 출력 포맷: 슬라이드별 구조화 텍스트
    ```
    [PPTX: filename.pptx]
    Slide 1:
    Title: <title>
    Content: <content>
    Notes: <notes>
    
    Slide 2:
    ...
    ```
  - Rust 구현: `zip` + XML 파싱 (office-rs 또는 직접 구현)

- [ ] **Word (.docx)**
  - 추출 방식: XML 파싱하여 단락/표/리스트 구조 유지
  - 출력 포맷: 구조화된 텍스트
    ```
    [DOCX: filename.docx]
    
    Heading 1: <h1>
    <paragraph text>
    
    - List item 1
    - List item 2
    
    Table:
    | Column 1 | Column 2 |
    | Cell 1   | Cell 2   |
    ```
  - Rust 구현: `docx-rs` 또는 `zip` + XML 파싱

- [ ] **Markdown (.md)**
  - 추출 방식: 파일 읽기 (변환 없이 그대로 사용)
  - 출력 포맷: 원본 마크다운
    ```
    [Markdown: filename.md]
    <original markdown content>
    ```
  - Rust 구현: `std::fs::read_to_string`

- [ ] **이미지 (.png, .jpg, .jpeg, .webp)**
  - 추출 방식: Base64 인코딩 후 vision API 활용 또는 설명 텍스트로 대체
  - 출력 포맷 (Option A - Vision API):
    ```
    [Image: filename.png]
    <base64 또는 vision API 결과>
    ```
  - 출력 포맷 (Option B - 설명 텍스트):
    ```
    [Image: filename.png]
    User note: <user-provided description>
    (Image content analysis not available in text mode)
    ```
  - Rust 구현: `base64` 크레이트 또는 사용자 입력 설명

#### 4.2.2 프로젝트별 첨부 파일 관리

- [ ] **저장 구조**
  - 파일 메타데이터: SQLite 테이블 추가 필요
    ```sql
    CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,  -- pdf, pptx, docx, md, image
        file_path TEXT,            -- 로컬 파일 경로 (optional)
        extracted_text TEXT,       -- 추출된 구조화 텍스트
        file_size INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    ```
  - 파일 저장 옵션:
    - Option A: 원본 파일을 app_data_dir에 복사 저장
    - Option B: 파일 경로만 참조 (외부 파일)

- [ ] **UI 관리**
  - Settings 화면에 "Attachments" 섹션 추가
  - 파일 업로드 버튼 (드래그 앤 드롭 지원)
  - 첨부 파일 리스트 표시 (파일명, 타입, 크기)
  - 개별 파일 삭제 버튼
  - 전체 채팅 탭이 동일 첨부 목록 공유

#### 4.2.3 모델 호출 시 텍스트 주입

- [ ] **프롬프트 구성**
  - System Context에 첨부 파일 텍스트 포함
  - 포맷:
    ```
    [첨부 파일]
    
    <extracted text from file 1>
    
    ---
    
    <extracted text from file 2>
    ```
  - 길이 제한: 전체 첨부 파일 텍스트 최대 8000자 (초과 시 경고)

- [ ] **Tauri Commands**
  - `attach_file`: 파일 선택/업로드 및 텍스트 추출
  - `list_attachments`: 프로젝트별 첨부 파일 목록 조회
  - `delete_attachment`: 첨부 파일 삭제
  - `extract_file_text`: 파일 타입별 텍스트 추출 로직

#### 4.2.4 구현 우선순위 및 세부 단계

1.  **단계 1: 인프라 구축**
    - [ ] SQLite `attachments` 테이블 추가 (`src-tauri/src/db/schema.rs`)
    - [ ] `Attachment` 모델 정의 (`src-tauri/src/models.rs`)
    - [ ] Tauri Commands 스켈레톤 구현 (`attach_file`, `list_attachments`, `delete_attachment`)

2.  **단계 2: 텍스트 추출 엔진 (Rust)**
    - [ ] **Markdown (.md)**: `std::fs::read_to_string` (완료)
    - [ ] **PDF (.pdf)**: `pdf-extract` 또는 `lopdf` 활용
    - [ ] **Word (.docx)**: `docx-rs` 활용
    - [ ] **PowerPoint (.pptx)**: Zip 파일 내 XML 파싱 (슬라이드 텍스트 추출)

3.  **단계 3: 프롬프트 연동**
    - [ ] `src/ai/prompt.ts`의 `buildLangChainMessages` 수정: 첨부 파일 텍스트 주입 로직 추가
    - [ ] 토큰/글자수 제한 (8,000자) 적용 및 초과 시 절단/경고

4.  **단계 4: UI 구현 (React)**
    - [ ] `ChatPanel.tsx`에 첨부 파일 업로드 및 목록 표시 UI 추가
    - [ ] 파일 선택기 연동 (`@tauri-apps/api/dialog`)
    - [ ] 업로드 중 로딩 상태 및 에러 표시

5.  **단계 5: 이미지 지원 (Optional/Future)**
    - [ ] 이미지 메타데이터 저장 및 Vision API 연동 준비

#### 4.2.5 에러 처리 및 폴백 (동일)

- 파일 파싱 실패 시: 원본 파일명 + 에러 메시지만 표시
- 지원하지 않는 파일 타입: 업로드 거부 + 지원 타입 안내
- 텍스트 추출 실패: 사용자에게 수동 설명 입력 요청 옵션
