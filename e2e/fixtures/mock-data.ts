/**
 * E2E Mock Data Factory
 *
 * 실제 타입(src/types/index.ts)에 맞는 mock 데이터 생성 함수.
 * Playwright 테스트에서 Tauri mock layer에 주입할 데이터를 만들 때 사용.
 */

export interface MockProject {
  id: string;
  version: string;
  metadata: {
    title: string;
    description?: string;
    domain: string;
    targetLanguage?: string;
    createdAt: number;
    updatedAt: number;
    author?: string;
    glossaryPaths?: string[];
    settings: {
      strictnessLevel: number;
      autoSave: boolean;
      autoSaveInterval: number;
      theme: 'light' | 'dark' | 'system';
    };
  };
  segments: Array<{
    groupId: string;
    sourceIds: string[];
    targetIds: string[];
    isAligned: boolean;
    order: number;
  }>;
  blocks: Record<
    string,
    {
      id: string;
      type: 'source' | 'target';
      content: string;
      hash: string;
      metadata: {
        author?: string;
        createdAt: number;
        updatedAt: number;
        tags: string[];
        comments?: unknown[];
      };
    }
  >;
}

export interface MockChatSession {
  id: string;
  name: string;
  createdAt: number;
  messages: unknown[];
  contextBlockIds: string[];
}

export interface MockSnapshotMeta {
  id: string;
  timestamp: number;
  description: string;
  chatSummary?: string;
}

let counter = 0;
function uid(): string {
  counter += 1;
  return `mock-${counter}-${Date.now()}`;
}

export function mockProject(overrides?: Partial<MockProject>): MockProject {
  const id = overrides?.id ?? uid();
  const now = Date.now();
  const srcBlockId = uid();
  const tgtBlockId = uid();
  const segId = uid();

  return {
    id,
    version: '1.0.0',
    metadata: {
      title: 'Test Project',
      domain: 'general',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 5000,
        theme: 'system',
      },
      ...overrides?.metadata,
    },
    segments: overrides?.segments ?? [
      {
        groupId: segId,
        sourceIds: [srcBlockId],
        targetIds: [tgtBlockId],
        isAligned: true,
        order: 0,
      },
    ],
    blocks: overrides?.blocks ?? {
      [srcBlockId]: {
        id: srcBlockId,
        type: 'source',
        content: '<p></p>',
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
      [tgtBlockId]: {
        id: tgtBlockId,
        type: 'target',
        content: '<p></p>',
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
    },
  };
}

export function mockChatSession(overrides?: Partial<MockChatSession>): MockChatSession {
  return {
    id: uid(),
    name: 'Default',
    createdAt: Date.now(),
    messages: [],
    contextBlockIds: [],
    ...overrides,
  };
}

export function mockSnapshotMeta(overrides?: Partial<MockSnapshotMeta>): MockSnapshotMeta {
  return {
    id: uid(),
    timestamp: Date.now(),
    description: 'Snapshot',
    ...overrides,
  };
}
