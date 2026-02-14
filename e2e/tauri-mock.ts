/**
 * Tauri Mock Layer for Playwright E2E Tests
 *
 * page.addInitScript()로 브라우저에 주입하여
 * window.__TAURI_INTERNALS__를 모킹합니다.
 *
 * - React/TipTap/Zustand는 실제 동작
 * - invoke() 호출만 mock 데이터 반환
 * - Rust 백엔드는 cargo test로 별도 커버
 */

import type { Page } from '@playwright/test';
import { mockProject, type MockProject } from './fixtures/mock-data';

/**
 * 브라우저에 주입할 mock 스크립트를 생성합니다.
 * 인메모리 상태로 projects, sessions, snapshots를 관리합니다.
 */
function buildMockScript(seedProjects: MockProject[]): string {
  return `
(function() {
  // ── In-memory state ──
  const projects = new Map(${JSON.stringify(seedProjects.map((p) => [p.id, p]))});
  const chatSessions = new Map();   // projectId → sessions[]
  const chatSettings = new Map();   // projectId → settings
  const snapshots = new Map();      // snapshotId → snapshot
  const secrets = new Map();        // key → value

  let projectIdCounter = 0;
  function uid() {
    projectIdCounter++;
    return 'mock-' + projectIdCounter + '-' + Date.now();
  }

  // ── Command handlers ──
  const handlers = {
    // ── App bootstrap ──
    secrets_initialize: () => ({ success: true, cachedCount: 0 }),
    list_project_ids: () => Array.from(projects.keys()),
    list_recent_projects: () => Array.from(projects.values()).map(p => ({
      id: p.id,
      title: p.metadata.title,
      updatedAt: p.metadata.updatedAt,
    })),
    mcp_registry_status: () => ({ servers: [] }),
    connector_list_status: () => [],
    cleanup_temp_images: () => 0,

    // ── Project management ──
    create_project: (args) => {
      const a = args?.args ?? args;
      const id = uid();
      const now = Date.now();
      const srcBlockId = uid();
      const tgtBlockId = uid();
      const segId = uid();
      const project = {
        id,
        version: '1.0.0',
        metadata: {
          title: a?.title ?? 'Untitled',
          domain: a?.domain ?? 'general',
          createdAt: now,
          updatedAt: now,
          settings: {
            strictnessLevel: 0.5,
            autoSave: true,
            autoSaveInterval: 5000,
            theme: 'system',
          },
        },
        segments: [{
          groupId: segId,
          sourceIds: [srcBlockId],
          targetIds: [tgtBlockId],
          isAligned: true,
          order: 0,
        }],
        blocks: {
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
      projects.set(id, project);
      return project;
    },

    load_project: (args) => {
      const a = args?.args ?? args;
      const id = a?.projectId ?? a?.id;
      const p = projects.get(id);
      if (!p) throw new Error('Project not found: ' + id);
      return p;
    },

    save_project: (args) => {
      const project = args?.project;
      if (project?.id) {
        projects.set(project.id, project);
      }
      return null;
    },

    duplicate_project: (args) => {
      const a = args?.args ?? args;
      const orig = projects.get(a?.projectId);
      if (!orig) throw new Error('Project not found');
      const dup = JSON.parse(JSON.stringify(orig));
      dup.id = uid();
      dup.metadata.title = orig.metadata.title + ' (Copy)';
      projects.set(dup.id, dup);
      return dup;
    },

    delete_project: (args) => {
      const a = args?.args ?? args;
      projects.delete(a?.projectId);
      return null;
    },

    export_project_file: () => null,
    import_project_file: () => [],
    import_project_file_safe: () => ({ projectIds: [], backupPath: '' }),
    delete_all_projects: () => { projects.clear(); return null; },

    // ── Chat sessions ──
    save_current_chat_session: () => null,
    load_current_chat_session: () => null,
    save_chat_sessions: (args) => {
      if (args?.projectId && args?.sessions) {
        chatSessions.set(args.projectId, args.sessions);
      }
      return null;
    },
    load_chat_sessions: (args) => {
      const a = args?.args ?? args;
      return chatSessions.get(a?.projectId) ?? [];
    },
    save_chat_project_settings: (args) => {
      if (args?.projectId) {
        chatSettings.set(args.projectId, args.settings ?? {});
      }
      return null;
    },
    load_chat_project_settings: (args) => {
      const a = args?.args ?? args;
      return chatSettings.get(a?.projectId) ?? null;
    },

    // ── History ──
    create_snapshot: (args) => {
      const a = args?.args ?? args;
      const id = uid();
      const snap = { id, timestamp: Date.now(), description: a?.description ?? '', snapshotJson: a?.snapshotJson ?? '{}' };
      snapshots.set(id, snap);
      return snap;
    },
    list_history: () => Array.from(snapshots.values()).map(s => ({
      id: s.id, timestamp: s.timestamp, description: s.description,
    })),
    get_snapshot: (args) => {
      const a = args?.args ?? args;
      return snapshots.get(a?.snapshotId) ?? null;
    },
    restore_snapshot: () => null,
    delete_snapshot: (args) => {
      const a = args?.args ?? args;
      snapshots.delete(a?.snapshotId);
      return null;
    },
    rename_snapshot: (args) => {
      const a = args?.args ?? args;
      const s = snapshots.get(a?.snapshotId);
      if (s) s.description = a?.description ?? s.description;
      return null;
    },

    // ── Secrets ──
    secrets_get: () => [],
    secrets_get_one: (args) => {
      const a = args?.args ?? args;
      return secrets.get(a?.key) ?? null;
    },
    secrets_set: () => null,
    secrets_set_one: (args) => {
      const a = args?.args ?? args;
      if (a?.key) secrets.set(a.key, a.value ?? '');
      return null;
    },
    secrets_delete: () => null,
    secrets_has: (args) => {
      const a = args?.args ?? args;
      return secrets.has(a?.key);
    },
    secrets_list_keys: () => Array.from(secrets.keys()),
    secrets_migrate_legacy: () => ({ migrated: 0, failed: 0, details: [] }),

    // ── Attachments ──
    attach_file: () => null,
    list_attachments: () => [],
    delete_attachment: () => null,
    preview_attachment: () => null,
    save_temp_image: () => '/tmp/mock-image.png',
    read_file_bytes: () => '',

    // ── MCP / Connectors ──
    list_mcp_servers: () => [],
    save_mcp_server: () => null,
    mcp_connect: () => null,
    mcp_disconnect: () => null,
    mcp_get_status: () => ({ connected: false }),
    mcp_get_tools: () => [],
    mcp_call_tool: () => ({}),
    mcp_check_auth: () => ({ authenticated: false }),
    mcp_logout: () => null,
    mcp_registry_connect: () => null,
    mcp_registry_disconnect: () => null,
    mcp_registry_get_tools: () => [],
    mcp_registry_call_tool: () => ({}),
    mcp_registry_clear_all: () => null,
    mcp_registry_logout: () => null,
    mcp_set_notion_config: () => null,

    // ── Connector tokens ──
    connector_get_token: () => null,
    connector_set_token: () => null,
    connector_delete_token: () => null,
    connector_start_oauth: () => null,

    // ── Notion ──
    notion_has_token: () => false,
    notion_set_token: () => null,
    notion_clear_token: () => null,
    notion_search: () => ({ results: [] }),
    notion_get_page: () => null,
    notion_get_page_content: () => '',
    notion_query_database: () => ({ results: [] }),

    // ── Confluence ──
    confluence_get_page_html: () => '',

    // ── Glossary ──
    search_glossary: () => [],
    import_glossary_csv: () => 0,
    import_glossary_excel: () => 0,

    // ── Block operations ──
    get_block: () => null,
    update_block: () => null,
    split_block: () => null,
    merge_blocks: () => null,

    // ── Legacy secure secrets ──
    get_secure_secret: () => null,
    set_secure_secret: () => null,
    delete_secure_secret: () => null,

    // ── Tauri dialog plugin (for flows guarded by confirm/message) ──
    'plugin:dialog|confirm': () => true,
    'plugin:dialog|ask': () => true,
    'plugin:dialog|message': () => null,
  };

  // ── __TAURI_INTERNALS__ injection ──
  const tauriInternals = {
    invoke: async (cmd, args) => {
      const handler = handlers[cmd];
      if (handler) {
        try {
          const result = await handler(args);
          return result;
        } catch (err) {
          throw err;
        }
      }
      console.warn('[TauriMock] Unhandled command:', cmd, args);
      return null;
    },
    transformCallback: (callback, once) => {
      const id = window.__TAURI_CB_ID__ || 0;
      window.__TAURI_CB_ID__ = id + 1;
      const name = '__TAURI_CB_' + id;
      window[name] = (payload) => {
        callback(payload);
        if (once) delete window[name];
      };
      return id;
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    convertFileSrc: (path) => 'file://' + path,
  };

  // Set both __TAURI__ and __TAURI_INTERNALS__ for isTauriRuntime() check
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: tauriInternals, writable: false });
  Object.defineProperty(window, '__TAURI__', { value: { __internals__: tauriInternals }, writable: false });
  window.__TAURI_CB_ID__ = 0;

  console.log('[TauriMock] Mock layer injected (' + projects.size + ' seed projects)');
})();
`;
}

/**
 * Playwright page에 Tauri mock layer를 주입합니다.
 *
 * @param page - Playwright Page 인스턴스
 * @param options - seed 데이터 옵션
 */
export async function injectTauriMock(
  page: Page,
  options?: { seedProjects?: MockProject[] },
): Promise<void> {
  const seeds = options?.seedProjects ?? [];
  await page.addInitScript({ content: buildMockScript(seeds) });
}

/**
 * 프로젝트가 이미 하나 있는 상태로 mock을 주입합니다.
 * (프로젝트 에디터 화면을 바로 테스트할 때 유용)
 */
export async function injectTauriMockWithProject(
  page: Page,
  projectOverrides?: Partial<MockProject>,
): Promise<MockProject> {
  const project = mockProject(projectOverrides);
  await injectTauriMock(page, { seedProjects: [project] });
  return project;
}
