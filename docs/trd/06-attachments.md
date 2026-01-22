# 6. 첨부 파일 (Reference Attachments)

## 6.1 확장 명세

### Why
- CSV/Excel뿐 아니라, PDF/PPTX/이미지/Markdown/DOCX 등 다양한 참고 자료를 "프로젝트에 첨부"하여 모델에 전달할 수 있어야 한다.

### What

#### 지원 파일(1차 목표)
- csv, xlsx/xls, pdf, pptx, png/jpg/webp, md, docx

#### 저장/공유
- 첨부 파일은 프로젝트 단위로 관리되며, 모든 채팅 탭이 동일 첨부 목록을 공유한다.

#### 채팅 전용 첨부(추가)
- 채팅 입력창(Composer)에서 첨부하는 파일/이미지는 **일회성(비영속)** 으로 관리한다.
- 채팅 전용 첨부는 **프로젝트 첨부(Settings)** 목록에 합쳐지지 않으며, **해당 메시지의 모델 호출 payload에만** 포함된다.

#### 모델 전달 원칙

**현재 구현(Phase 1):**
- 문서(pdf/docx/pptx/md/txt)는 로컬에서 텍스트를 추출하여 system context로 주입한다(길이 제한 적용).
- 이미지(png/jpg/jpeg/webp/gif)는 **멀티모달(vision) 입력**으로, 로컬 파일을 base64로 읽어 표준 content blocks로 모델 입력에 포함한다(파일 크기/개수 제한 적용).
  - **LangChain 통합 형식**: OpenAI/Anthropic 모두 동일한 `image_url` 형식 사용 (`{ type: 'image_url', image_url: { url: 'data:image/...;base64,...' } }`)
  - LangChain `@langchain/anthropic`이 내부적으로 Anthropic native 형식(`source: { type: 'base64', media_type, data }`)으로 변환

**향후(확장):**
- Provider가 제공하는 "파일 업로드/첨부(file_id 등)" 메커니즘을 사용해 원형 전달을 지원할 수 있다.

**호환성/폴백:**
- 특정 모델/Provider에서 멀티모달/첨부가 불가한 경우 에러 메시지 또는 안내 메시지로 폴백한다.
- 과도한 컨텍스트 방지를 위해 파일별/전체 길이 제한 및 우선순위(사용자 선택/최근 첨부/키워드 매칭)를 둔다.
