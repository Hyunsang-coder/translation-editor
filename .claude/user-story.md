# OddEyes.ai 사용자 스토리 (End-to-End)

## 목적
실제 사용자가 앱을 설치하고 모든 기능을 활용하여 문서 번역, 리뷰까지 완료하는 전체 워크플로우.

---

## 📋 배경

**사용자**: 마리아(스페인어 → 영어 번역가)
**목표**: 스페인어로 작성된 기술 문서를 영어로 번역 및 검수
**문서**: Confluence에 저장된 "API 통합 가이드" (약 2,000단어)

---

## Phase 1: 설치 및 초기 설정

### Step 1.1: 앱 설치

**마리아가 하는 일:**
1. https://github.com/.../ 에서 최신 릴리스 다운로드
2. macOS: `OddEyes-ai_1.7.3_aarch64.dmg` 또는 `universal-apple-darwin.dmg` 다운로드
3. 설치 마법사 따라 진행 (Install → Applications 폴더로 드래그)
4. Gatekeeper 보안 경고 → "Open" 클릭

**예상 결과:**
- ✅ 앱 실행 (초기 로딩 2-3초)
- ✅ 빈 프로젝트 목록 화면 표시
- ✅ 설정 아이콘 (⚙️) 클릭 가능

**검증 포인트:**
```
[ ] 메뉴바에 OddEyes 아이콘 표시
[ ] 윈도우 크기 정상 (1400x900 이상 권장)
[ ] 모든 텍스트 한국어 또는 영어로 표시됨
```

---

### Step 1.2: API 키 등록 (OpenAI)

**마리아가 하는 일:**
1. 우측 설정 탭 → **"AI Providers"** 섹션
2. **"OpenAI"** 상자에서 API Key 입력 필드 클릭
3. OpenAI 대시보드 (https://platform.openai.com/api-keys) 접속
4. API 키 생성 (또는 기존 키 복사)
   - 키 예시: `sk-proj-1a2b3c...` (52자)
5. 마리아의 앱에 붙여넣기
6. Enable 체크박스로 프로바이더 활성화

**입력값:**
```
OpenAI API Key: sk-proj-abcdef123456...
```

**예상 결과:**
- ✅ 키는 OS 키체인에 암호화되어 저장 (localStorage X)
- ✅ 키 입력 필드에 별표(****) 마스킹 표시
- ✅ Enable 체크박스로 프로바이더 활성화/비활성화

**검증 포인트:**
```
[ ] 키 입력 필드에 별표(****) 마스킹 표시
[ ] 키 값이 개발자 도구(DevTools)에서 노출되지 않음
[ ] Enable/Disable 체크박스 정상 작동
[ ] 키 지우기(Clear) 버튼 정상 작동
```

---

### Step 1.3: API 키 등록 (Anthropic)

**마리아가 하는 일:**
1. 같은 설정 탭에서 **"Anthropic"** 상자 찾기
2. https://console.anthropic.com/api-keys 에서 API 키 복사
3. 앱의 Anthropic 입력 필드에 붙여넣기
   - 키 예시: `sk-ant-1a2b3c...` (50+자)
4. Enable 체크박스로 프로바이더 활성화

**입력값:**
```
Anthropic API Key: sk-ant-xyz123...
```

**예상 결과:**
- ✅ 키는 OS 키체인에 암호화되어 저장
- ✅ 두 프로바이더 모두 활성화 상태 표시

**검증 포인트:**
```
[ ] 두 API 키 모두 입력 완료 확인
[ ] Enable/Disable 체크박스 정상 작동
[ ] 프로바이더 전환 시 모델 옵션도 함께 변경
```

---

## Phase 2: 커넥터 연결

### Step 2.1: Confluence 커넥터 등록

**마리아가 하는 일:**
1. 설정 탭 → **"Connectors"** 섹션
2. **"Confluence"** 카드에서 "+ Connect" 버튼 클릭
3. 브라우저 팝업 또는 Tauri 웹뷰로 Atlassian OAuth 페이지 열림
4. 회사 계정 (예: maria@company.atlassian.net) 로그인
5. OddEyes 앱에 대한 권한 승인 클릭
   - 요청 권한: "Read Confluence pages", "Search content"
6. 리디렉트 → 앱으로 돌아옴

**예상 결과:**
- ✅ Confluence 토큰이 OS 키체인에 저장됨
- ✅ **"Confluence Connected ✓"** 상태 표시
- ✅ Confluence 검색 가능 상태로 변경
- ✅ "+ Disconnect" 버튼 표시 (나중에 연결 해제 가능)

**검증 포인트:**
```
[ ] OAuth 플로우 정상 작동
[ ] 토큰 OS 키체인에 저장 (로컬 스토리지 X)
[ ] 앱 재시작 후 자동 로그인 유지
[ ] 만료된 토큰 자동 갱신 구현 (또는 재연결 프롬프트)
```

---

### Step 2.2: Notion 커넥터 등록

**마리아가 하는 일:**
1. **"Notion"** 카드에서 "+ Connect" 클릭
2. Notion 로그인 및 권한 승인 (Confluence와 동일)
3. 마리아의 워크스페이스 선택 (드롭다운 제시)

**입력값:**
```
Workspace: "Company Docs" 선택
```

**예상 결과:**
- ✅ Notion 커넥터 활성화
- ✅ Notion 데이터베이스 목록 표시 (선택 가능)

**검증 포인트:**
```
[ ] Notion OAuth 정상 작동
[ ] 토큰 키체인 저장
[ ] 여러 워크스페이스 지원 (드롭다운)
```

---

### Step 2.3: Web Search 활성화

**마리아가 하는 일:**
1. **"Web Search"** 토글 스위치 → **ON**
2. (선택사항) API 키 필요한 경우 입력 (예: SerpAPI, Google Custom Search)

**예상 결과:**
- ✅ 웹 검색 아이콘 활성화
- ✅ 채팅에서 "Search Web" 도구 사용 가능

**검증 포인트:**
```
[ ] 토글 UI 부드럽게 전환
[ ] 설정 자동 저장 (수동 저장 버튼 X)
```

---

## Phase 3: 프로젝트 생성

### Step 3.1: 새 프로젝트 생성

**마리아가 하는 일:**
1. 좌측 사이드바에서 **"+"** 버튼 클릭
2. 프로젝트 이름 입력: "API Integration Guide Translation"
3. **"Create"** 또는 엔터 키 클릭

**입력값:**
```
Name: API Integration Guide Translation
```

**예상 결과:**
- ✅ 새 프로젝트 생성 후 **프로젝트 대시보드** 열림
- ✅ Source 에디터 (좌측) 및 Target 에디터 (우측) 빈 상태로 표시
- ✅ 프로젝트 목록에 새 항목 추가
- ✅ 프로젝트 정보 저장 (SQLite)

**검증 포인트:**
```
[ ] 프로젝트 생성 성공 후 자동 열림
[ ] 이전 프로젝트는 닫힘 (중복 열림 X)
[ ] 프로젝트 목록 갱신
```

---

## Phase 4: 원문 입력

### Step 4.1: Source 에디터에 문서 입력

**마리아가 하는 일:**
1. **Source Panel** (좌측 에디터) 클릭
2. Confluence에서 스페인어 문서 복사 (또는 샘플 텍스트 입력)

**샘플 입력 (Spanish):**
```
# Guía de Integración de API

## Introducción

Esta guía proporciona instrucciones detalladas para integrar nuestra API REST en su aplicación.

## Requisitos Previos

- Node.js 14.x o superior
- npm 6.x o superior
- Conocimiento básico de JavaScript

## Instalación

### Paso 1: Instalar la dependencia

npm install @mycompany/api-client

### Paso 2: Configurar las credenciales

Cree un archivo `.env` en la raíz del proyecto:

API_KEY=your_api_key_here
API_ENDPOINT=https://api.example.com

### Paso 3: Inicializar el cliente

const ApiClient = require('@mycompany/api-client');
const client = new ApiClient({
  apiKey: process.env.API_KEY,
  endpoint: process.env.API_ENDPOINT
});

## Ejemplos de Uso

### Obtener usuario

client.users.get(userId).then(user => {
  console.log(user);
});

### Crear transacción

client.transactions.create({
  amount: 100,
  currency: 'USD',
  description: 'Payment for order #123'
}).then(transaction => {
  console.log('Transacción creada:', transaction.id);
});

## Manejo de Errores

Siempre maneje los errores de API:

try {
  const result = await client.request(...);
} catch (error) {
  if (error.status === 401) {
    console.error('API key inválida');
  } else if (error.status === 429) {
    console.error('Límite de velocidad excedido');
  }
}

## Conclusión

Para más información, visite nuestra documentación: https://docs.example.com/api
```

3. 텍스트 입력 (붙여넣기 또는 타이핑)
4. 자동 저장 대기 (500ms)

**예상 결과:**
- ✅ 텍스트 Source 에디터에 실시간 렌더링
- ✅ 마크다운 포맷팅 감지 (## 제목 → 굵은 글씨 등)
- ✅ 코드 블록 자동 감지 (회색 박스)
- ✅ 자동 저장 인디케이터 표시 (아이콘 변화)
- ✅ 단어 수 표시 (우측 상단, 약 550단어)
- ✅ 문서 내용 SQLite에 저장 (TipTap JSON 형식)

**검증 포인트:**
```
[ ] 텍스트 입력 지연 없음 (부드러운 타이핑)
[ ] 마크다운 스타일링 정상 작동
[ ] 코드 블록 표시 정상 (회색 박스)
[ ] 자동 저장 중 UI 반응성 유지
[ ] 단어 수 정확함
[ ] 에디터 이미지 붙여넣기 가능 (선택적)
[ ] 마크다운 붙여넣기 정상 변환
```

---

### Step 4.2: 문서 편집 (TipTap 기능 테스트)

**마리아가 하는 일:**
1. Source 에디터에서 텍스트 선택 및 포맷팅 테스트

**작업 1: 제목 포맷팅**
- "Guía de Integración de API" 선택 → "Heading 1" 적용
- "Introducción" 선택 → "Heading 2" 적용

**작업 2: 강조**
- "Node.js 14.x" 선택 → 굵게(Bold) 적용
- "npm 6.x" 선택 → 이탤릭(Italic) 적용

**작업 3: 리스트**
- 코드 블록 전후 엔터 확인 (줄바꿈 정상)
- 불릿 리스트 생성 (선택사항)

**작업 4: 링크 추가**
- "https://docs.example.com/api" 텍스트 선택 → "Link" 아이콘 클릭
- 링크 URL 확인 (자동 감지 또는 수동 입력)

**예상 결과:**
- ✅ 모든 포맷팅 명령 즉시 적용
- ✅ Undo/Redo 정상 작동 (Cmd+Z / Cmd+Shift+Z)
- ✅ 포맷팅 변경 후 자동 저장
- ✅ 에디터 상단 도구모음 버튼들 반응

**검증 포인트:**
```
[ ] 텍스트 선택 시 포맷팅 버튼 활성화
[ ] 포맷팅 적용 즉시 반영
[ ] Undo/Redo 스택 정상 작동
[ ] 여러 포맷(Bold + Italic) 동시 적용 가능
[ ] 링크 자동 감지 정상
```

---

## Phase 5: 번역 실행

### Step 5.1: Translate 버튼 클릭

**마리아가 하는 일:**
1. Source 에디터 상단 **"Translate"** 버튼 클릭
2. 앱 설정에서 지정한 AI Provider/Model로 번역 시작

**예상 결과:**
- ✅ 로딩 상태 시작 (스피너 표시, "Translating..." 메시지)
- ✅ 약 10-20초 대기 (문서 크기 및 AI 응답 속도에 따라)
- ✅ 번역 완료 후 **Preview Modal** 팝업

**검증 포인트:**
```
[ ] 번역 중 UI 반응성 유지 (타이핑 가능, 취소 가능)
[ ] 로딩 상태 명확히 표시
[ ] 에러 발생 시 에러 메시지 + "Retry" 버튼
```

---

### Step 5.2: 번역 결과 미리보기

**마리아가 하는 일:**
1. **Preview Modal** 검토:
   - 좌측: 원본 (Spanish)
   - 우측: 번역 (English)
   - 또는 Diff 뷰: 변경 부분 강조

2. 번역 품질 확인:
   - "Transacción creada" → "Transaction created" ✓
   - "Límite de velocidad" → "Rate limit" ✓
   - 코드 블록 보존 ✓
   - 마크다운 포맷팅 보존 ✓

3. **"Apply"** 또는 **"Accept"** 클릭

**대안 (품질 문제 발견 시):**
- **"Retry"** 클릭 (재번역)
- **"Cancel"** 클릭 (번역 취소)

**예상 결과:**
- ✅ Preview Modal 명확하고 읽기 쉬움
- ✅ 원본과 번역 비교 용이
- ✅ "Apply" 클릭 후 Target 에디터에 번역 텍스트 삽입
- ✅ Apply 직전 자동 스냅샷 생성 ("번역 적용 전 자동 저장" — 히스토리에서 복원 가능)
- ✅ Undo 가능 (Ctrl+Z로 이전 상태 복원)
- ✅ 자동 저장 (번역 적용 후)

**검증 포인트:**
```
[ ] Preview Modal 반응성 (스크롤 가능)
[ ] Diff 뷰 정상 작동 (변경 부분 강조)
[ ] Apply/Retry/Cancel 버튼 반응
[ ] Target 에디터 자동 스크롤 (상단으로)
[ ] 이전 Target 내용 완전히 대체 (병합 X)
[ ] TipTap JSON 형식 유지
```

---

### Step 5.3: Target 에디터에서 수동 편집

**마리아가 하는 일:**
1. Target Panel (우측 에디터) 클릭
2. 번역 텍스트 검토 및 수정:

**수정 1: 용어 일관성**
- "API key" 모든 인스턴스 선택
- 이전에 정의한 용어와 일치하는지 확인
- 필요시 "API credential" 또는 "API key" 중 선택

**수정 2: 톤 조정**
- "Basic knowledge of JavaScript" → "Fundamental JavaScript knowledge" (더 격식체로)

**수정 3: 숫자 포맷**
- "14.x or higher" → "version 14.x or later" (일관성)

**예상 결과:**
- ✅ Target 에디터에서 실시간 편집 가능
- ✅ 변경 사항 즉시 저장
- ✅ 수정 후 자동 저장 인디케이터 (아이콘 또는 메시지)

**검증 포인트:**
```
[ ] Target 에디터 편집 가능
[ ] 수정 사항 자동 저장
[ ] Undo/Redo 정상 작동
[ ] Source와 Target 동시 표시 가능
```

---

## Phase 6: 리뷰 기능

### Step 6.1: Review 시작

**마리아가 하는 일:**
1. Target Panel 상단 **"Review"** 버튼 또는 우측 사이드바 "Review" 탭 클릭
2. 리뷰 옵션 확인 (선택사항):
   - Focus areas: Grammar, Terminology, Tone, Style
   - Language: English (US)

3. **"Start Review"** 클릭

**예상 결과:**
- ✅ 리뷰 로딩 상태 시작 (약 10-15초)
- ✅ 완료 후 **Review Results** 패널 표시

---

### Step 6.2: 리뷰 결과 확인 및 필터링

**리뷰 결과 (예시):**
```
Issue #1 (Critical)
Line: "This guide provides detailed instructions for integrating..."
Problem: Missing subject "This guide" is implied but not explicit
Suggestion: Add clarity - consider restructuring the sentence

Issue #2 (Major)
Line: "Basic knowledge of JavaScript"
Problem: Informal tone detected. Should match technical documentation style.
Suggestion: Change to "Fundamental understanding of JavaScript" or "JavaScript fundamentals"

Issue #3 (Major)
Line: "API_KEY=your_api_key_here"
Problem: Placeholder text should be more descriptive
Suggestion: Change to "API_KEY=<your_actual_api_key>"

Issue #4 (Minor)
Line: "Rate limit exceeded"
Problem: Could be more specific about action
Suggestion: Add context: "Rate limit exceeded. Please retry after 60 seconds."
```

**마리아가 하는 일:**
1. **Severity Filter** 확인:
   - 기본값: "Critical" + "Major" 표시 (Minor 숨김)
   - "Show All" 클릭하여 Minor 이슈도 표시 (선택사항)

2. **Review Results Table** 검토:
   - 각 이슈의 Line, Problem, Suggestion 확인
   - 체크박스 선택 (자동 적용할 이슈)

3. **개별 이슈 처리**:

**이슈 #2 처리:**
- Suggestion "Fundamental understanding of JavaScript" 선택
- **"Apply Suggestion"** 또는 자동 클릭
- Target 에디터에서 해당 라인 자동으로 "Basic knowledge of JavaScript" → "Fundamental understanding of JavaScript"로 변경

**이슈 #3 처리:**
- Suggestion 검토: 타당함
- **"Apply"** 클릭

**이슈 #4 처리:**
- 마리아가 수동으로 편집하기로 결정
- **"Dismiss"** 클릭 (이슈 무시)
- Target 에디터에서 직접 수정: "Rate limit exceeded" → "Rate limit exceeded. Please retry after 60 seconds."

4. 모든 이슈 처리 완료 후 **"Review Complete"** 메시지 표시

**예상 결과:**
- ✅ 리뷰 이슈 테이블 명확히 표시
- ✅ Severity 필터 정상 작동
- ✅ Suggestion 적용 시 Target 에디터 자동 업데이트
- ✅ Dismiss 이슈는 테이블에서 제거 (옵션: 별도 섹션에 남기기)
- ✅ Applied Suggestion 자동 저장
- ✅ 일괄 적용 직전 자동 스냅샷 생성 ("검수 재번역 적용 전 자동 저장" — 히스토리에서 복원 가능)

**검증 포인트:**
```
[ ] Review 결과 테이블 레이아웃 정상
[ ] Severity 필터 (Critical/Major/Minor) 정상 작동
[ ] Suggestion 클릭 시 Target 에디터 자동 스크롤
[ ] Applied Suggestion 즉시 반영
[ ] Dismiss된 이슈 시각적으로 구분
```

---

## Phase 7: 채팅 기능

### Step 7.1: Chat 사이드바 열기

**마리아가 하는 일:**
1. 우측 사이드바 **"Chat"** 탭 클릭 (또는 우측 상단 Chat 아이콘)
2. Chat Panel 열림

**예상 결과:**
- ✅ Chat 패널 우측에 표시
- ✅ 채팅 히스토리 표시 (있을 경우, 지금은 비어있음)
- ✅ 하단 메시지 입력 필드 활성화

---

### Step 7.2: 첫 번째 질문 - 용어 확인

**마리아가 하는 질문:**
```
"In the context of API integration, what's the difference between
'API endpoint' and 'API URL'? Should I use both terms or stick to one
for consistency in technical documentation?"
```

**마리아가 하는 일:**
1. Chat 입력 필드에 위 텍스트 입력
2. **"Send"** 또는 엔터 키 누름

**예상 결과:**
- ✅ 메시지 즉시 Chat 히스토리에 표시
- ✅ 로딩 상태 (스피너) → AI 응답 대기 (3-5초)
- ✅ AI 응답 스트리밍 표시 (토큰이 하나씩 들어오며 텍스트 증가)

**검증 포인트:**
```
[ ] Chat 메시지 입력 부드러운 동작
[ ] AI 응답 스트리밍 정상 작동
[ ] 응답 중 UI 반응성 유지
[ ] 메시지 히스토리 유지
[ ] 스크롤 자동 하단으로 (새 메시지)
```

---

### Step 7.3: 도구 활용 - Confluence 검색

**마리아가 하는 질문:**
```
"Can you search our Confluence for examples of how we documented
API authentication in previous versions? I want to ensure consistency."
```

**마리아가 하는 일:**
1. 위 메시지 입력 및 전송
2. AI가 Confluence 검색 도구 자동 호출
3. 응답에 검색 결과 포함

**예상 결과:**
- ✅ Confluence 검색 자동 호출 (사용자 명시 X)
- ✅ 검색 결과 대화에 포함
- ✅ AI가 검색 결과 기반 제안 제공

**검증 포인트:**
```
[ ] Confluence 검색 자동 호출
[ ] 검색 결과 대화에 포함
[ ] 검색 결과 최신 문서 우선
[ ] 토큰 효율성 (전체 문서 아닌 요약만 포함)
```

---

### Step 7.4: Notion 참고 자료 추가

**마리아가 하는 질문:**
```
"Can you check our Notion glossary for the official Spanish-to-English
terminology for 'transacción'? I want to ensure it matches our brand
guidelines."
```

**마리아가 하는 일:**
1. 메시지 전송
2. AI가 Notion 검색 도구 호출

**예상 결과:**
- ✅ Notion 검색 자동 호출
- ✅ 용어 검색 및 결과 제공
- ✅ Brand guidelines 반영

---

## Phase 8: 히스토리 (스냅샷) 관리

### Step 8.1: 히스토리 드로어 열기

**마리아가 하는 일:**
1. 툴바 드롭다운 메뉴에서 **"히스토리"** (Clock 아이콘) 클릭
2. 우측에서 히스토리 드로어 슬라이드인

**예상 결과:**
- ✅ 오른쪽 드로어 (w-96) 열림
- ✅ 자동 스냅샷 목록 표시 (번역 적용 시 자동 생성된 것들)
- ✅ 상단 "스냅샷 저장" 버튼 표시
- ✅ 각 스냅샷에 설명 + 상대 시간 표시 (예: "2시간 전", "방금")

**검증 포인트:**
```
[ ] 드로어 열기/닫기 애니메이션 부드러움
[ ] 스냅샷 최신순 정렬
[ ] 상대 시간 언어 감지 (한국어/영어)
[ ] 프로젝트 전환 시 히스토리 초기화
```

---

### Step 8.2: 수동 스냅샷 저장

**마리아가 하는 일:**
1. 히스토리 드로어 상단 **"스냅샷 저장"** 버튼 클릭
2. 설명 입력 다이얼로그:
   ```
   설명 (선택): "리뷰 반영 완료 후 최종본"
   ```
3. **"저장"** 클릭

**예상 결과:**
- ✅ 스냅샷 생성 (전체 blocks 상태 JSON으로 저장)
- ✅ "스냅샷이 저장되었습니다." 메시지
- ✅ 타임라인에 새 스냅샷 즉시 추가
- ✅ 설명 비워두면 "수동 스냅샷" 기본 문구 삽입

**검증 포인트:**
```
[ ] 빈 설명 시 기본값 삽입
[ ] 저장 후 목록 즉시 갱신
[ ] 프로젝트당 최대 50개 제한 (초과 시 오래된 것 자동 삭제)
```

---

### Step 8.3: 자동 스냅샷 확인

**마리아가 확인하는 자동 스냅샷들:**

| 시점 | 설명 |
|------|------|
| 번역 적용 직전 | "번역 적용 전 자동 저장" |
| 리뷰 일괄 적용 직전 | "검수 재번역 적용 전 자동 저장" |
| 스냅샷 복원 직전 | "복원 전 자동 저장" |

**예상 결과:**
- ✅ Phase 5에서 번역 Apply 시 자동 스냅샷 생성됨
- ✅ Phase 6에서 리뷰 일괄 적용 시 자동 스냅샷 생성됨
- ✅ 자동 스냅샷 실패해도 메인 동작(번역/리뷰 적용) 차단하지 않음

---

### Step 8.4: 스냅샷 비교 (현재 상태 vs 과거)

**마리아가 하는 일:**
1. 타임라인에서 "번역 적용 전 자동 저장" 스냅샷의 **"비교"** 버튼 클릭
2. 비교 모달 열림 (전체 화면 85vh)

**비교 모달 내용:**
```
┌──────────────────────────────────────────────────┐
│         스냅샷 vs 현재 상태 비교                    │
├─────────────────────┬────────────────────────────┤
│   Original (스냅샷)  │   Suggested (현재 상태)      │
│                     │                            │
│ 스냅샷 시점의 Target  │ 현재 Target 에디터 내용      │
│ 문서 내용            │                            │
│                     │                            │
│ (삭제된 부분 빨간색)  │ (추가된 부분 초록색)          │
└─────────────────────┴────────────────────────────┘
```

**예상 결과:**
- ✅ VisualDiffViewer로 좌우 비교 표시
- ✅ 변경된 부분 색상 강조 (삭제: 빨강, 추가: 초록)
- ✅ 스크롤 동기화
- ✅ 스냅샷끼리 비교는 미지원 (스냅샷 vs 현재 상태만)

**검증 포인트:**
```
[ ] 비교 모달 레이아웃 정상
[ ] Diff 강조 정확함
[ ] 대용량 문서에서도 성능 유지
[ ] 모달 닫기 정상
```

---

### Step 8.5: 스냅샷 복원

**마리아가 하는 일:**
1. 타임라인에서 "번역 적용 전 자동 저장" 스냅샷의 **"복원"** 버튼 클릭
2. 확인 다이얼로그:
   ```
   스냅샷을 복원할까요?
   복원 전에 현재 상태를 자동 스냅샷으로 저장한 뒤
   선택한 시점으로 되돌립니다.
   ```
3. **"복원"** 클릭

**복원 플로우:**
1. 현재 상태 자동 스냅샷 ("복원 전 자동 저장")
2. 선택한 스냅샷의 blocks 로드
3. projectStore 업데이트
4. Source/Target 에디터에 `replaceDocContent()` 적용
5. 프로젝트 저장

**예상 결과:**
- ✅ "스냅샷이 복원되었습니다." 메시지
- ✅ Source/Target 에디터 모두 스냅샷 시점으로 복원
- ✅ 복원 전 현재 상태가 자동 스냅샷으로 남아있음 (되돌리기의 되돌리기 가능)
- ✅ 히스토리 목록에 "복원 전 자동 저장" 추가됨

**검증 포인트:**
```
[ ] 복원 확인 다이얼로그 표시
[ ] 복원 전 자동 스냅샷 생성
[ ] 에디터 내용 정확히 복원
[ ] 복원 후 자동 저장
[ ] 복원 후 되돌리기 가능 (복원 전 스냅샷 이용)
```

---

### Step 8.6: 스냅샷 이름 변경 및 삭제

**마리아가 하는 일 (이름 변경):**
1. 스냅샷의 **"이름 변경"** 버튼 클릭
2. 새 이름 입력: "최종 검수 완료본"
3. **"저장"** 클릭

**마리아가 하는 일 (삭제):**
1. 불필요한 스냅샷의 **"삭제"** 버튼 클릭
2. 확인: "이 스냅샷을 삭제하시겠습니까?"
3. **"확인"** 클릭

**예상 결과:**
- ✅ 이름 변경 즉시 반영
- ✅ 삭제 후 목록에서 제거
- ✅ 빈 이름은 저장 불가 (버튼 비활성화)

---

## Phase 9: 프로젝트 목록 및 관리

### Step 9.1: 프로젝트 목록 확인

**마리아가 하는 일:**
1. 홈 화면으로 돌아감 (좌측 "Projects" 클릭 또는 Back 버튼)
2. 프로젝트 목록 확인

**예상 결과:**
- ✅ 완료된 프로젝트 리스트 표시
- ✅ 마지막 편집 시간 표시

---

### Step 9.2: 프로젝트 메뉴 옵션

**메뉴 옵션 (우클릭):**
```
[ ] Open
[ ] Rename
[ ] Duplicate
[ ] Delete
```

**마리아가 하는 일:**
1. **"Duplicate"** 선택 → 프로젝트 복사 (다른 언어 쌍용)
2. 또는 **"Delete"** 선택 → 프로젝트 삭제 (확인 대화 필수)

**예상 결과:**
- ✅ Duplicate 선택 시 새 프로젝트 생성 (복사본)
- ✅ Delete 선택 시 확인 대화 + 실행

---

## ✅ 검증 체크리스트

### 설치 및 초기 설정
- [ ] 앱 설치 성공
- [ ] API 키 입력 및 저장 정상
- [ ] 커넥터 연결 정상
- [ ] 설정값 저장 (SQLite + 키체인)

### 프로젝트 관리
- [ ] 프로젝트 생성 성공
- [ ] 프로젝트 목록 갱신
- [ ] 프로젝트 복제 정상
- [ ] 프로젝트 삭제 정상

### 에디터 기능
- [ ] Source 입력 부드러운 동작
- [ ] TipTap 포맷팅 정상
- [ ] Target 자동 업데이트
- [ ] Undo/Redo 정상

### 번역 기능
- [ ] 번역 API 호출 성공
- [ ] 번역 결과 미리보기 명확
- [ ] Apply 후 Target 업데이트
- [ ] 자동 저장 정상

### 리뷰 기능
- [ ] 리뷰 분석 정확도
- [ ] Severity 필터 정상
- [ ] 제안 적용 정상

### 채팅 기능
- [ ] 메시지 입력/전송 정상
- [ ] AI 응답 스트리밍 정상
- [ ] Confluence 검색 자동 호출
- [ ] Notion 검색 자동 호출
- [ ] 멀티턴 대화 일관성

### 히스토리 (스냅샷)
- [ ] 히스토리 드로어 열기/닫기 정상
- [ ] 수동 스냅샷 저장 정상
- [ ] 자동 스냅샷 생성 (번역 적용, 리뷰 적용, 복원 시)
- [ ] 스냅샷 vs 현재 상태 비교 (VisualDiffViewer)
- [ ] 스냅샷 복원 정상 (복원 전 자동 스냅샷 포함)
- [ ] 스냅샷 이름 변경 정상
- [ ] 스냅샷 삭제 정상
- [ ] 프로젝트당 최대 50개 제한 동작
- [ ] 상대 시간 표시 (Intl.RelativeTimeFormat)

### 성능
- [ ] UI 반응성 (지연 < 100ms)
- [ ] 메모리 누수 없음 (프로젝트 여러 번 열고 닫기)
- [ ] 자동 저장 부하 관찰
- [ ] 대용량 문서 성능 (< 5MB 문서)

---

## 예상 완료 시간

| Phase | 작업 | 소요 시간 |
|-------|------|---------|
| 1 | 설치 및 초기 설정 | 5분 |
| 2 | 커넥터 연결 | 5분 |
| 3 | 프로젝트 생성 | 2분 |
| 4 | 원문 입력 (550단어) | 5분 |
| 5 | 번역 실행 | 5분 |
| 6 | 리뷰 실행 | 5분 |
| 7 | 채팅 | 10분 |
| 8 | 히스토리 (스냅샷) 관리 | 5분 |
| 9 | 프로젝트 관리 | 2분 |
| **총계** | | **44분** |

---

## 고급 시나리오 (선택사항 테스트)

### 오류 복구
- API 키 만료 후 갱신 프로세스
- 네트워크 오류 중 번역 재시도
- 큰 문서 타임아웃 처리

### 다중 세션
- 두 개의 프로젝트 동시 열기 (듀얼 사이드바)
- 탭 전환 시 상태 유지
- 한 탭에서 채팅, 다른 탭에서 번역 동시 작업

---

## 참고사항

이 사용자 스토리는 다음을 가정합니다:
1. **API 키**: OpenAI + Anthropic 모두 유효
2. **커넥터**: Confluence + Notion 로그인 유효
3. **네트워크**: 인터넷 연결 안정적
4. **OS**: macOS (또는 Windows/Linux로 조정)
5. **언어**: 스페인어 → 영어 기본, 다른 언어도 가능

테스트 중 오류 발생 시:
- 브라우저 DevTools (F12) 콘솔 확인
- 앱 로그 확인 (`~/Library/Logs/oddEyes.ai/`)
- GitHub Issues에 버그 리포팅
