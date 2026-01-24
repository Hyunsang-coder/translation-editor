# 2. 에디터 엔진 설계 (Editor Engine: TipTap)

## 2.1 Target/Source Pane 커스터마이징 (Document Mode)

### Why
- 번역가는 코드가 아닌 문서를 다루므로, Notion 스타일의 문서 편집 경험이 필요합니다.

### How
- TipTap 두 인스턴스(Source, Target)를 사용하며, 공통 스타일을 적용합니다.
- Source/Target 모두 편집 가능 상태로 두되, Focus Mode에서 Source를 숨길 수 있습니다.

### What (권장 옵션)
- **폰트/스타일**: Noto Sans KR (로컬 번들, @fontsource), 16px, line-height 1.8, max-width 800px, padding 24px
- **지원 포맷**: Heading(H1-H6), Bullet/Ordered List, Bold, Italic, Strike, Blockquote, Link, Table, Image, Placeholder, (선택) Code Block
- **추가 포맷 (에디터 전용)**: Underline, Highlight, Subscript, Superscript
  - 에디터에서 완전히 지원되는 TipTap Extension
  - Markdown 변환 시 손실됨 (번역 파이프라인에서는 보존되지 않음)
- **Source/Target 붙여넣기**: 웹페이지/Confluence HTML은 **붙여넣기 시점에만** 최소한의 정규화(허용 태그/속성 화이트리스트, 구조 단순화, 테이블 헤더 중복 제거)를 적용하여 표 파싱 안정성 확보

### Extension 동기화 규칙
- `TipTapEditor.tsx`의 extensions와 `markdownConverter.ts`의 `getExtensions()`는 반드시 동기화 필요
- 불일치 시 "no mark type X in schema" 에러 발생
- 새 Extension 추가 시 양쪽 모두 업데이트 필수

### 검색/치환 기능
TipTap 에디터 내 검색 및 치환 지원:
- **검색**: `Cmd+F` (Source/Target 모두)
- **치환**: `Cmd+H` (Target 전용, 원문 보호)
- **기능**: 대소문자 구분, 이전/다음 매치 탐색, 단일 치환, 전체 치환
- **구현**: `SearchHighlight` TipTap Extension (Decoration 기반), `SearchBar` UI 컴포넌트
