# 15. 웹 시연용 버전 (Web Demo Version)

> **상태**: 계획 단계 (미착수)

## 1. 개요

OddEyes.ai 데스크톱 앱(Tauri)을 웹 브라우저에서 동작하는 시연용 버전으로 전환하기 위한 기술 요구사항.

### 1.1 목표
- Tauri 없이 순수 웹 환경에서 핵심 번역 기능 동작
- API 키 보안 유지 (서버 프록시)
- 데모/시연 목적에 적합한 단순화

### 1.2 결정 사항
| 항목 | 선택 |
|-----|------|
| API 키 관리 | Vercel Edge Functions (서버 프록시) |
| MCP 연동 | 제외 (Confluence, Notion) |
| 배포 플랫폼 | Vercel |

---

## 2. 아키텍처 변경

### 2.1 현재 (Tauri)
```
React App ─── Tauri IPC ─── Rust Backend ─── OS APIs
                              │
                    ├── SQLite (프로젝트 저장)
                    ├── Keychain (API 키)
                    ├── File System (첨부파일)
                    └── MCP Client (Confluence/Notion)
```

### 2.2 웹 버전
```
React App ─── Platform Layer ─┬─ IndexedDB (저장)
                              ├─ Vercel Edge (AI API)
                              └─ File API (첨부)

Vercel Edge Functions
├── /api/ai/chat      → OpenAI/Anthropic
├── /api/ai/translate → OpenAI/Anthropic
└── /api/ai/review    → OpenAI/Anthropic
        │
        └── 환경변수: OPENAI_API_KEY, ANTHROPIC_API_KEY
```

---

## 3. 기능 범위

### 3.1 포함 기능
| 기능 | 구현 방식 |
|-----|----------|
| TipTap 에디터 (Source/Target) | 변경 없음 |
| AI 번역 | Vercel Edge 프록시 |
| AI 채팅 + Tool Calling | Vercel Edge 프록시 |
| 번역 검수 (Review) | Vercel Edge 프록시 |
| 글로서리 | IndexedDB |
| 프로젝트 저장/로드 | IndexedDB |
| 웹 검색 | OpenAI Web Search |

### 3.2 제외 기능
| 기능 | 제외 사유 |
|-----|----------|
| Confluence 연동 | CORS + OAuth 복잡도 |
| Notion 연동 | CORS + OAuth 복잡도 |
| MCP 서버 관리 | Rust 네이티브 의존성 |
| .ite 파일 임포트/내보내기 | SQLite 직렬화 복잡도 |
| 자동 업데이트 | 웹은 항상 최신 |
| OS Keychain | 웹 환경 불가 |

---

## 4. 플랫폼 추상화 레이어

### 4.1 디렉토리 구조
```
src/
├── platform/
│   ├── index.ts          # 플랫폼 감지 및 dynamic import
│   ├── types.ts          # 공통 인터페이스
│   ├── tauri/            # Tauri 구현 (기존 src/tauri/ 이동)
│   │   ├── invoke.ts
│   │   ├── project.ts
│   │   ├── storage.ts
│   │   ├── chat.ts
│   │   ├── attachments.ts
│   │   ├── connector.ts
│   │   ├── glossary.ts
│   │   └── secrets.ts
│   └── web/              # 웹 구현 (신규)
│       ├── db.ts         # IndexedDB 스키마 (Dexie.js)
│       ├── storage.ts    # 프로젝트 CRUD
│       ├── chat.ts       # 채팅 저장/로드
│       ├── attachments.ts # 첨부파일 처리
│       ├── glossary.ts   # 글로서리
│       └── secrets.ts    # LocalStorage (개발용)
```

### 4.2 플랫폼 감지
```typescript
// src/platform/index.ts
import { isTauriRuntime } from './tauri/invoke';

export const platform = isTauriRuntime()
  ? await import('./tauri')
  : await import('./web');

// 사용처
import { platform } from '@/platform';
await platform.saveProject(project);
await platform.loadChatSessions(projectId);
```

### 4.3 공통 인터페이스
```typescript
// src/platform/types.ts
export interface PlatformStorage {
  createProject(name: string): Promise<Project>;
  loadProject(id: string): Promise<Project>;
  saveProject(project: Project): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  deleteProject(id: string): Promise<void>;
}

export interface PlatformChat {
  loadChatSessions(projectId: string): Promise<ChatSession[]>;
  saveChatSessions(projectId: string, sessions: ChatSession[]): Promise<void>;
}

export interface PlatformAttachments {
  attachFile(projectId: string, file: File): Promise<Attachment>;
  listAttachments(projectId: string): Promise<Attachment[]>;
  deleteAttachment(id: string): Promise<void>;
  readImageAsDataUrl(path: string): Promise<string>;
}

export interface PlatformGlossary {
  searchGlossary(projectId: string, query: string): Promise<GlossaryEntry[]>;
  importGlossaryCsv(projectId: string, file: File): Promise<number>;
}
```

---

## 5. 데이터 저장소

### 5.1 IndexedDB 스키마 (Dexie.js)
```typescript
// src/platform/web/db.ts
import Dexie, { Table } from 'dexie';

interface ProjectRecord {
  id: string;
  name: string;
  domain?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationRules?: string;
  contexts?: string;
  sourceDoc?: object;  // TipTap JSON
  targetDoc?: object;  // TipTap JSON
  createdAt: number;
  updatedAt: number;
}

interface ChatSessionRecord {
  id: string;
  projectId: string;
  label: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface GlossaryRecord {
  id: string;
  projectId: string;
  sourceTerm: string;
  targetTerm: string;
  note?: string;
}

interface AttachmentRecord {
  id: string;
  projectId: string;
  name: string;
  type: string;
  data: ArrayBuffer;
  createdAt: number;
}

export class OddEyesDB extends Dexie {
  projects!: Table<ProjectRecord>;
  chatSessions!: Table<ChatSessionRecord>;
  glossary!: Table<GlossaryRecord>;
  attachments!: Table<AttachmentRecord>;

  constructor() {
    super('oddeyes');
    this.version(1).stores({
      projects: 'id, name, updatedAt',
      chatSessions: 'id, projectId, updatedAt',
      glossary: 'id, projectId, [projectId+sourceTerm]',
      attachments: 'id, projectId'
    });
  }
}

export const db = new OddEyesDB();
```

### 5.2 용량 제한
| 브라우저 | 기본 할당량 | 최대 |
|---------|-----------|------|
| Chrome | 사용 가능 디스크의 60% | ~무제한 |
| Firefox | 50MB (확장 가능) | ~무제한 |
| Safari | 1GB | 1GB |

대용량 첨부파일 사용 시 경고 UI 표시 권장.

---

## 6. Vercel Edge Functions

### 6.1 API 엔드포인트
```
api/
├── ai/
│   ├── chat.ts         # POST /api/ai/chat (채팅)
│   ├── translate.ts    # POST /api/ai/translate (번역)
│   └── review.ts       # POST /api/ai/review (검수)
```

### 6.2 환경변수
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
BRAVE_API_KEY=...
```

Vercel Dashboard → Settings → Environment Variables에서 설정.

### 6.3 예시 구현
```typescript
// api/ai/chat.ts
import { OpenAI } from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const { messages, model, stream } = await req.json();

  const isAnthropic = model.startsWith('claude-');

  if (isAnthropic) {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    if (stream) {
      // SSE 스트리밍 응답
      return new Response(
        new ReadableStream({
          async start(controller) {
            const response = await anthropic.messages.stream({
              model,
              messages,
              max_tokens: 4096,
            });

            for await (const chunk of response) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
            }
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        }
      );
    }

    const response = await anthropic.messages.create({
      model,
      messages,
      max_tokens: 4096,
    });

    return Response.json(response);
  }

  // OpenAI 처리...
}
```

### 6.4 프론트엔드 클라이언트 변경
```typescript
// src/ai/client.ts (웹 버전)
export async function callAI(params: AIParams) {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (params.stream) {
    // SSE 스트림 처리
    return handleSSEStream(response);
  }

  return response.json();
}
```

---

## 7. MCP 비활성화 처리

### 7.1 조건부 렌더링
```typescript
// src/components/panels/SettingsSidebar.tsx
import { isTauriRuntime } from '@/platform';

function SettingsSidebar() {
  return (
    <div>
      {/* 공통 설정 */}
      <APIKeySection />
      <TranslationRulesSection />

      {/* Tauri에서만 표시 */}
      {isTauriRuntime() && <MCPConnectorsSection />}
    </div>
  );
}
```

### 7.2 Store 초기화
```typescript
// src/stores/connectorStore.ts
export const useConnectorStore = create<ConnectorState>((set, get) => ({
  // 웹에서는 모든 커넥터 비활성화
  confluenceEnabled: isTauriRuntime() ? false : false,
  notionEnabled: isTauriRuntime() ? false : false,

  // 웹에서는 초기화 스킵
  async initTokenStatus() {
    if (!isTauriRuntime()) return;
    // ... Tauri 초기화 로직
  },
}));
```

---

## 8. 배포 설정

### 8.1 vercel.json
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

### 8.2 GitHub Actions (선택)
```yaml
# .github/workflows/deploy-web.yml
name: Deploy Web Demo

on:
  push:
    branches: [web-demo]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

---

## 9. 마이그레이션 경로

### 9.1 단계별 구현

| 단계 | 작업 | 예상 기간 |
|-----|------|----------|
| 1 | 플랫폼 추상화 레이어 (`src/platform/`) | 1-2주 |
| 2 | IndexedDB 스토리지 구현 | 2-3주 |
| 3 | Vercel Edge Functions | 1주 |
| 4 | MCP 비활성화 처리 | 2-3일 |
| 5 | 배포 및 테스트 | 1주 |
| **합계** | | **5-7주** |

### 9.2 검증 체크리스트
- [ ] 로컬 웹 모드 테스트 (`npm run dev`, Tauri 없이)
- [ ] IndexedDB 프로젝트 생성/저장/로드
- [ ] API 프록시 테스트 (`vercel dev`)
- [ ] 스트리밍 응답 동작 확인
- [ ] 번역 전체 플로우: 프로젝트 생성 → 번역 → 채팅 → 검수
- [ ] Vercel Preview 배포 테스트
- [ ] Production 배포

---

## 10. 보안 고려사항

### 10.1 API 키 보호
- ✅ Vercel 환경변수에 저장 (클라이언트 노출 없음)
- ✅ Edge Function 내부에서만 API 키 사용
- ⚠️ API 엔드포인트 남용 방지: Rate Limiting 고려

### 10.2 Rate Limiting (선택)
```typescript
// api/middleware/rateLimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '1 m'), // 분당 20회
});

export async function checkRateLimit(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'anonymous';
  const { success } = await ratelimit.limit(ip);
  if (!success) {
    return new Response('Too Many Requests', { status: 429 });
  }
  return null;
}
```

### 10.3 CORS 설정
```typescript
// api/ai/chat.ts
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://your-domain.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

---

## 11. 알려진 제한사항

| 제한 | 설명 | 대안 |
|-----|------|------|
| 대용량 프로젝트 | IndexedDB 용량 제한 | 프로젝트 크기 경고 UI |
| 오프라인 사용 | API 프록시 필요 | Service Worker 캐싱 (부분) |
| 프로젝트 공유 | .ite 파일 미지원 | JSON 내보내기/가져오기 |
| MCP 연동 | 웹에서 불가 | 데스크톱 앱 사용 안내 |

---

## 12. 향후 확장 가능성

1. **PWA 지원**: Service Worker로 오프라인 편집 (AI 제외)
2. **클라우드 동기화**: Firebase/Supabase로 프로젝트 동기화
3. **.ite 파일 지원**: sql.js로 SQLite 파싱/생성
4. **협업 기능**: Y.js로 실시간 공동 편집
