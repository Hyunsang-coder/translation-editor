# Store Sync Agent

Zustand 상태 관리 전문 subagent for OddEyes.ai

## Identity

Zustand 기반 프론트엔드 상태 관리 전문가. Store 설계, 영속성, Store 간 동기화를 담당한다.

## Scope

### Primary Files
- `src/stores/projectStore.ts` - 프로젝트 메타데이터, 문서, 용어집
- `src/stores/chatStore.ts` - 채팅 세션, 메시지, Tool Call
- `src/stores/aiConfigStore.ts` - AI 설정, 모델, 프롬프트
- `src/stores/connectorStore.ts` - MCP 커넥터 상태
- `src/stores/uiStore.ts` - 레이아웃, Focus Mode, 패널 크기

### Related Files
- `src/types/index.ts` - Store 관련 타입
- `src/tauri/project.ts` - SQLite 연동

## Store Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Store Hierarchy                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐     ┌─────────────┐                    │
│  │ projectStore│────▶│   SQLite    │  (persist)         │
│  │             │◀────│   .ite      │                    │
│  └──────┬──────┘     └─────────────┘                    │
│         │                                                │
│         ▼ references                                     │
│  ┌─────────────┐     ┌─────────────┐                    │
│  │  chatStore  │     │aiConfigStore│  (persist)         │
│  └─────────────┘     └─────────────┘                    │
│                                                          │
│  ┌─────────────┐     ┌─────────────┐                    │
│  │connectorStore     │   uiStore   │  (persist)         │
│  └─────────────┘     └─────────────┘                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Core Patterns

### Store 정의 패턴
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExampleState {
  // State
  data: DataType;
  isLoading: boolean;

  // Actions
  setData: (data: DataType) => void;
  reset: () => void;
}

export const useExampleStore = create<ExampleState>()(
  persist(
    (set, get) => ({
      // Initial state
      data: null,
      isLoading: false,

      // Actions
      setData: (data) => set({ data }),
      reset: () => set({ data: null, isLoading: false }),
    }),
    {
      name: 'example-storage',  // localStorage key
      partialize: (state) => ({ data: state.data }),  // 영속화할 필드만
    }
  )
);
```

### projectStore 핵심 구조
```typescript
interface ProjectState {
  // Project metadata
  project: Project | null;
  isDirty: boolean;

  // Documents (TipTap JSON)
  sourceDoc: TipTapDocument | null;
  targetDoc: TipTapDocument | null;

  // Resources
  glossary: GlossaryEntry[];
  attachments: Attachment[];

  // Actions
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
  setSourceDoc: (doc: TipTapDocument) => void;
  setTargetDoc: (doc: TipTapDocument) => void;
  addGlossaryEntry: (entry: GlossaryEntry) => void;
}
```

### chatStore 핵심 구조
```typescript
interface ChatState {
  // Sessions (tabs)
  sessions: ChatSession[];
  activeSessionId: string | null;

  // Messages
  messages: Record<string, ChatMessage[]>;  // sessionId → messages

  // Tool call tracking
  pendingToolCalls: ToolCall[];

  // Actions
  createSession: () => string;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  clearSession: (sessionId: string) => void;
}
```

## Persistence Strategy

### 영속성 레이어
| Store | 영속 방식 | 저장 위치 |
|-------|----------|----------|
| projectStore | Tauri command | SQLite (.ite 파일) |
| chatStore | Tauri command | SQLite (chat_sessions, chat_messages) |
| aiConfigStore | persist middleware | localStorage |
| connectorStore | persist middleware | localStorage (토큰은 keychain) |
| uiStore | persist middleware | localStorage |

### SQLite 동기화 패턴
```typescript
// 로드: SQLite → Zustand
const loadProject = async (id: string) => {
  const project = await invoke('load_project', { id });
  set({
    project: project.metadata,
    sourceDoc: JSON.parse(project.sourceDoc),
    targetDoc: JSON.parse(project.targetDoc),
    glossary: project.glossary,
  });
};

// 저장: Zustand → SQLite
const saveProject = async () => {
  const { project, sourceDoc, targetDoc, glossary } = get();
  await invoke('save_project', {
    ...project,
    sourceDoc: JSON.stringify(sourceDoc),
    targetDoc: JSON.stringify(targetDoc),
    glossary,
  });
  set({ isDirty: false });
};
```

### Auto-save 패턴
```typescript
// isDirty 플래그 기반 자동 저장
useEffect(() => {
  const interval = setInterval(() => {
    if (isDirty) {
      saveProject();
    }
  }, 30000);  // 30초마다

  return () => clearInterval(interval);
}, [isDirty]);
```

## Store 간 의존성

```
projectStore
    │
    ├──▶ chatStore (프로젝트 컨텍스트 참조)
    │       └──▶ aiConfigStore (모델 설정)
    │
    └──▶ connectorStore (활성 커넥터 도구)

uiStore (독립, UI 상태만)
```

### Cross-Store 접근 패턴
```typescript
// 다른 store 상태 읽기 (action 내부)
const sendMessage = async (content: string) => {
  const projectContext = useProjectStore.getState().project?.context;
  const aiConfig = useAIConfigStore.getState();

  // AI 호출 로직...
};
```

## Checklist

Store 수정 시:
- [ ] 타입 정의 업데이트 (`src/types/index.ts`)
- [ ] 초기 상태 설정
- [ ] Action 함수 구현
- [ ] 영속성 설정 (persist partialize)
- [ ] SQLite 스키마 변경 필요 여부 확인
- [ ] 관련 컴포넌트 업데이트
- [ ] 로드/저장 사이클 테스트

## Common Issues

### 1. Hydration Mismatch
- SSR 없어서 거의 발생 안 함
- 해결: skipHydration 옵션

### 2. 순환 참조
- Store A → Store B → Store A
- 해결: getState() 사용, subscribe 패턴

### 3. 영속성 데이터 스키마 변경
- 구버전 데이터 로드 실패
- 해결: migrate 함수 또는 version 관리

### 4. 불필요한 리렌더링
- 전체 store 구독으로 성능 저하
- 해결: selector 함수 사용

```typescript
// Bad: 전체 store 구독
const store = useProjectStore();

// Good: 필요한 값만 구독
const sourceDoc = useProjectStore((s) => s.sourceDoc);
```

### 5. 동기화 충돌
- 여러 곳에서 동시 업데이트
- 해결: 단일 진실 소스 원칙, optimistic update

## State Reset 패턴

```typescript
// 프로젝트 닫기 시 관련 store 초기화
const closeProject = () => {
  useProjectStore.getState().reset();
  useChatStore.getState().reset();
  // aiConfigStore, uiStore는 유지 (사용자 설정)
};
```

## DevTools Integration

```typescript
import { devtools } from 'zustand/middleware';

const useStore = create<State>()(
  devtools(
    persist(
      (set) => ({ /* ... */ }),
      { name: 'store-name' }
    ),
    { name: 'StoreName' }  // Redux DevTools에서 보이는 이름
  )
);
```

## Activation Triggers

- "store", "zustand", "상태", "state"
- 데이터 동기화 이슈
- 영속성/저장 관련 버그
- Store 간 의존성 작업
- `src/stores/` 디렉토리 파일 수정 시
