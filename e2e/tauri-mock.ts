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
  const glossaries = new Map();     // glossaryId → glossary
  const glossaryEntries = new Map();// glossaryId → entries[]
  const projectGlossaryIds = new Map(); // projectId → ordered glossaryIds[]
  const projectMemory = new Map(); // projectId → { items, forbiddenTerms, revision }

  let projectIdCounter = 0;
  function uid() {
    projectIdCounter++;
    return 'mock-' + projectIdCounter + '-' + Date.now();
  }

  // 시스템 프롬프트의 ---X_START/END--- 마커를 감지해 같은 마커로 감싼
  // 고정 응답을 돌려준다 (번역/부분 재번역 등 마커 기반 워크플로우 공용).
  const MOCK_AI_BODY = 'Mock AI 응답입니다.';
  function buildMockAiText(a) {
    const system = (a && a.messages || []).find((m) => m.role === 'system');
    const marker = ((system && system.content) || '').match(/---([A-Z_]+)_START---/);
    if (!marker) return MOCK_AI_BODY;
    return '---' + marker[1] + '_START---\\n' + MOCK_AI_BODY + '\\n---' + marker[1] + '_END---';
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
      projectGlossaryIds.set(
        dup.id,
        [...(projectGlossaryIds.get(a?.projectId) ?? [])],
      );
      const memory = projectMemory.get(a?.projectId);
      if (memory) {
        projectMemory.set(dup.id, JSON.parse(JSON.stringify({
          ...memory,
          projectId: dup.id,
          items: memory.items.map(item => ({ ...item, projectId: dup.id })),
          forbiddenTerms: memory.forbiddenTerms.map(term => ({ ...term, projectId: dup.id })),
        })));
      }
      return dup;
    },

    delete_project: (args) => {
      const a = args?.args ?? args;
      projects.delete(a?.projectId);
      projectMemory.delete(a?.projectId);
      return null;
    },

    export_project_file: () => null,
    import_project_file: () => [],
    import_project_file_safe: () => ({ projectIds: [], backupPath: '' }),
    delete_all_projects: () => { projects.clear(); return null; },

    // ── Project memory / forbidden terms ──
    load_project_memory: (args) => {
      const a = args?.args ?? args;
      const projectId = a?.projectId;
      return projectMemory.get(projectId) ?? {
        projectId,
        items: [],
        forbiddenTerms: [],
        revision: 0,
      };
    },
    migrate_legacy_project_memory: () => false,
    add_project_memory_item: (args) => {
      const a = args?.args ?? args;
      const state = projectMemory.get(a?.projectId) ?? {
        projectId: a?.projectId,
        items: [],
        forbiddenTerms: [],
        revision: 0,
      };
      const normalized = String(a?.content ?? '').trim().toLowerCase();
      const duplicate = state.items.find(item => (
        item.status === 'active' && item.normalizedHash === normalized
      ));
      if (duplicate) {
        return { item: duplicate, revision: state.revision, duplicate: true };
      }
      const now = Date.now();
      const item = {
        id: uid(),
        projectId: a?.projectId,
        category: a?.category ?? 'general',
        content: String(a?.content ?? '').trim(),
        normalizedHash: normalized,
        status: a?.status ?? 'active',
        source: a?.source ?? 'user',
        sourceSessionId: a?.sourceSessionId ?? null,
        sourceMessageId: a?.sourceMessageId ?? null,
        sourceSelectionId: a?.sourceSelectionId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      const next = { ...state, items: [...state.items, item], revision: state.revision + 1 };
      projectMemory.set(a?.projectId, next);
      return { item, revision: next.revision, duplicate: false };
    },
    replace_project_memory_item: (args) => {
      const a = args?.args ?? args;
      const state = projectMemory.get(a?.projectId);
      const current = state?.items.find(item => item.id === a?.targetItemId);
      if (!state || !current) throw new Error('Project memory item not found');
      const item = {
        ...current,
        category: a?.category ?? current.category,
        content: String(a?.content ?? '').trim(),
        normalizedHash: String(a?.content ?? '').trim().toLowerCase(),
        source: a?.source ?? 'user',
        sourceSessionId: a?.sourceSessionId ?? null,
        sourceMessageId: a?.sourceMessageId ?? null,
        sourceSelectionId: a?.sourceSelectionId ?? null,
        updatedAt: Date.now(),
      };
      const next = {
        ...state,
        items: state.items.map(existing => existing.id === current.id ? item : existing),
        revision: state.revision + 1,
      };
      projectMemory.set(a?.projectId, next);
      return { item, revision: next.revision };
    },
    delete_project_memory_item: (args) => {
      const a = args?.args ?? args;
      const state = projectMemory.get(a?.projectId);
      const current = state?.items.find(item => item.id === a?.itemId);
      if (!state || !current) throw new Error('Project memory item not found');
      const next = {
        ...state,
        items: state.items.filter(existing => existing.id !== current.id),
        revision: state.revision + 1,
      };
      projectMemory.set(a?.projectId, next);
      return { revision: next.revision };
    },
    import_project_memory_items: (args) => {
      const a = args?.args ?? args;
      const source = projectMemory.get(a?.sourceProjectId);
      const target = projectMemory.get(a?.targetProjectId) ?? {
        projectId: a?.targetProjectId,
        items: [],
        forbiddenTerms: [],
        revision: 0,
      };
      const itemIds = a?.itemIds ?? [];
      const termIds = a?.termIds ?? [];
      const now = Date.now();
      // 카테고리는 보지 않는다 (db::import_project_memory_data와 동일).
      const seenItems = new Set(target.items.map(item => item.normalizedHash));
      const seenTerms = new Set(
        target.forbiddenTerms.map(term => String(term.term).trim().toLowerCase()),
      );
      const items = [...target.items];
      const forbiddenTerms = [...target.forbiddenTerms];
      let importedItems = 0;
      let skippedItems = 0;
      let importedTerms = 0;
      let skippedTerms = 0;

      for (const item of (source?.items ?? [])) {
        if (item.status !== 'active' || !itemIds.includes(item.id)) continue;
        const key = item.normalizedHash;
        if (seenItems.has(key)) { skippedItems += 1; continue; }
        seenItems.add(key);
        items.push({
          ...item,
          id: uid(),
          projectId: a?.targetProjectId,
          status: 'active',
          source: 'import',
          sourceSessionId: null,
          sourceMessageId: null,
          sourceSelectionId: null,
          createdAt: now,
          updatedAt: now,
        });
        importedItems += 1;
      }
      for (const term of (source?.forbiddenTerms ?? [])) {
        if (!termIds.includes(term.id)) continue;
        const key = String(term.term).trim().toLowerCase();
        if (seenTerms.has(key)) { skippedTerms += 1; continue; }
        seenTerms.add(key);
        forbiddenTerms.push({
          ...term,
          id: uid(),
          projectId: a?.targetProjectId,
          createdAt: now,
          updatedAt: now,
        });
        importedTerms += 1;
      }

      const revision = importedItems > 0 || importedTerms > 0
        ? target.revision + 1
        : target.revision;
      projectMemory.set(a?.targetProjectId, {
        ...target,
        items,
        forbiddenTerms,
        revision,
      });
      return { importedItems, skippedItems, importedTerms, skippedTerms, revision };
    },
    upsert_forbidden_term: (args) => {
      const a = args?.args ?? args;
      const state = projectMemory.get(a?.projectId) ?? {
        projectId: a?.projectId,
        items: [],
        forbiddenTerms: [],
        revision: 0,
      };
      const existing = state.forbiddenTerms.find(term => term.id === a?.id);
      const now = Date.now();
      const term = {
        id: existing?.id ?? uid(),
        projectId: a?.projectId,
        term: String(a?.term ?? '').trim(),
        replacement: a?.replacement ?? null,
        note: a?.note ?? null,
        enabled: a?.enabled !== false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const terms = existing
        ? state.forbiddenTerms.map(value => value.id === term.id ? term : value)
        : [...state.forbiddenTerms, term];
      const next = { ...state, forbiddenTerms: terms, revision: state.revision + 1 };
      projectMemory.set(a?.projectId, next);
      return { term, revision: next.revision };
    },
    delete_forbidden_term: (args) => {
      const a = args?.args ?? args;
      const state = projectMemory.get(a?.projectId);
      if (!state) return { revision: 0 };
      const next = {
        ...state,
        forbiddenTerms: state.forbiddenTerms.filter(term => term.id !== a?.id),
        revision: state.revision + 1,
      };
      projectMemory.set(a?.projectId, next);
      return { revision: next.revision };
    },

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
      const snap = { id, timestamp: Date.now(), description: a?.description ?? '', snapshotJson: a?.snapshotJson ?? '{}', kind: 'manual' };
      snapshots.set(id, snap);
      return snap;
    },
    list_history: () => Array.from(snapshots.values()).map(s => ({
      id: s.id, timestamp: s.timestamp, description: s.description, kind: s.kind ?? 'manual',
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

    // ── Connector tokens ──
    connector_get_token: () => null,
    connector_set_token: () => null,
    connector_delete_token: () => null,
    connector_start_oauth: () => null,

    // ── Confluence ──
    confluence_get_page_html: () => '',

    // ── AI backend (marker-echo mock) ──
    ai_complete: (args) => {
      const a = args?.args ?? args;
      return { text: buildMockAiText(a) };
    },
    ai_stream: (args) => {
      const a = args?.args ?? args;
      const text = buildMockAiText(a);
      // args.onEvent는 in-process Channel 인스턴스라 onmessage로 직접 델타 전달
      const channel = args?.onEvent;
      if (channel && typeof channel.onmessage === 'function') {
        channel.onmessage({ type: 'delta', text });
      }
      return { text };
    },
    ai_stream_cancel: () => null,

    // ── Glossary ──
    search_glossary: (args) => {
      const a = args?.args ?? args;
      const query = (a?.query ?? '').trim();
      if (!query) return [];
      const domain = a?.domain ?? null;
      const seen = new Set();
      const matches = [];
      for (const [priority, glossaryId] of (projectGlossaryIds.get(a?.projectId) ?? []).entries()) {
        for (const entry of glossaryEntries.get(glossaryId) ?? []) {
          if (domain && entry.domain && entry.domain !== domain) continue;
          const matched = entry.caseSensitive
            ? query.includes(entry.source)
            : query.toLowerCase().includes(entry.source.toLowerCase());
          if (matched) matches.push({ ...entry, priority });
        }
      }
      matches.sort((left, right) => (
        left.priority - right.priority
        || right.source.length - left.source.length
        || left.createdAt - right.createdAt
      ));
      return matches.filter(entry => {
        const normalized = entry.source.trim().toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      }).slice(0, Math.min(a?.limit ?? 12, 50)).map(({ priority: _priority, ...entry }) => entry);
    },
    import_glossary_csv: (args) => {
      const a = args?.args ?? args;
      const glossaryId = a?.glossaryId;
      if (!glossaryId || !glossaries.has(glossaryId)) {
        throw new Error('Glossary not found: ' + glossaryId);
      }
      // E2E stub: treat import as success without parsing file contents.
      return { inserted: 0, updated: 0, skipped: 0, warnings: [] };
    },
    import_glossary_excel: (args) => {
      const a = args?.args ?? args;
      const glossaryId = a?.glossaryId;
      if (!glossaryId || !glossaries.has(glossaryId)) {
        throw new Error('Glossary not found: ' + glossaryId);
      }
      return { inserted: 0, updated: 0, skipped: 0, warnings: [] };
    },
    list_glossaries: () => Array.from(glossaries.values()).map(g => ({
      ...g,
      entryCount: (glossaryEntries.get(g.id) ?? []).length,
    })),
    create_glossary: (args) => {
      const a = args?.args ?? args;
      const now = Date.now();
      const glossary = {
        id: uid(),
        name: a?.name ?? 'Glossary',
        description: a?.description ?? null,
        entryCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      glossaries.set(glossary.id, glossary);
      glossaryEntries.set(glossary.id, []);
      return glossary;
    },
    update_glossary: (args) => {
      const a = args?.args ?? args;
      const current = glossaries.get(a?.glossaryId);
      if (!current) throw new Error('Glossary not found');
      const updated = {
        ...current,
        name: a?.name ?? current.name,
        description: a?.description ?? null,
        updatedAt: Date.now(),
        entryCount: (glossaryEntries.get(current.id) ?? []).length,
      };
      glossaries.set(current.id, updated);
      return updated;
    },
    delete_glossary: (args) => {
      const a = args?.args ?? args;
      glossaries.delete(a?.glossaryId);
      glossaryEntries.delete(a?.glossaryId);
      for (const [projectId, ids] of projectGlossaryIds) {
        projectGlossaryIds.set(projectId, ids.filter(id => id !== a?.glossaryId));
      }
      return null;
    },
    list_glossary_entries: (args) => {
      const a = args?.args ?? args;
      const query = (a?.query ?? '').trim().toLowerCase();
      return (glossaryEntries.get(a?.glossaryId) ?? []).filter(entry => (
        !query
        || entry.source.toLowerCase().includes(query)
        || entry.target.toLowerCase().includes(query)
        || (entry.notes ?? '').toLowerCase().includes(query)
      ));
    },
    create_glossary_entry: (args) => {
      const a = args?.args ?? args;
      const source = (a?.source ?? '').trim();
      const target = (a?.target ?? '').trim();
      if (!source || !target) throw new Error('Source and target are required');
      const entries = glossaryEntries.get(a?.glossaryId) ?? [];
      if (entries.some(entry => entry.source.trim().toLowerCase() === source.toLowerCase())) {
        throw new Error('An entry with the same source already exists in this glossary.');
      }
      const now = Date.now();
      const entry = {
        id: uid(),
        glossaryId: a?.glossaryId,
        source,
        target,
        notes: a?.notes ?? null,
        domain: a?.domain ?? null,
        caseSensitive: a?.caseSensitive ?? false,
        createdAt: now,
        updatedAt: now,
      };
      glossaryEntries.set(a?.glossaryId, [
        ...(glossaryEntries.get(a?.glossaryId) ?? []),
        entry,
      ]);
      return entry;
    },
    update_glossary_entry: (args) => {
      const a = args?.args ?? args;
      const source = (a?.source ?? '').trim();
      const target = (a?.target ?? '').trim();
      if (!source || !target) throw new Error('Source and target are required');
      for (const [glossaryId, entries] of glossaryEntries) {
        const index = entries.findIndex(entry => entry.id === a?.entryId);
        if (index < 0) continue;
        if (entries.some(entry => (
          entry.id !== a?.entryId
          && entry.source.trim().toLowerCase() === source.toLowerCase()
        ))) {
          throw new Error('An entry with the same source already exists in this glossary.');
        }
        const updated = {
          ...entries[index],
          source,
          target,
          notes: a?.notes ?? null,
          domain: a?.domain ?? null,
          caseSensitive: a?.caseSensitive ?? false,
          updatedAt: Date.now(),
        };
        entries[index] = updated;
        glossaryEntries.set(glossaryId, entries);
        return updated;
      }
      throw new Error('Glossary entry not found');
    },
    delete_glossary_entry: (args) => {
      const a = args?.args ?? args;
      for (const [glossaryId, entries] of glossaryEntries) {
        glossaryEntries.set(glossaryId, entries.filter(entry => entry.id !== a?.entryId));
      }
      return null;
    },
    list_project_glossaries: (args) => {
      const a = args?.args ?? args;
      return (projectGlossaryIds.get(a?.projectId) ?? [])
        .map((id, priority) => {
          const glossary = glossaries.get(id);
          return glossary ? {
            ...glossary,
            entryCount: (glossaryEntries.get(id) ?? []).length,
            priority,
          } : null;
        })
        .filter(Boolean);
    },
    set_project_glossaries: (args) => {
      const a = args?.args ?? args;
      projectGlossaryIds.set(a?.projectId, [...(a?.glossaryIds ?? [])]);
      return (a?.glossaryIds ?? []).map((id, priority) => {
        const glossary = glossaries.get(id);
        return glossary ? {
          ...glossary,
          entryCount: (glossaryEntries.get(id) ?? []).length,
          priority,
        } : null;
      }).filter(Boolean);
    },

    // ── Block operations ──
    get_block: () => null,
    update_block: () => null,
    split_block: () => null,
    merge_blocks: () => null,

    // ── Legacy secure secrets ──
    // AI 생성 경로가 키 부재로 막히지 않도록 mock 키 번들을 돌려준다
    get_secure_secret: (args) => {
      const key = args?.key ?? args?.args?.key;
      if (key === 'ai:api_keys_bundle') {
        return JSON.stringify({ openai: 'sk-mock-openai', anthropic: 'sk-mock-anthropic' });
      }
      return null;
    },
    set_secure_secret: () => null,
    delete_secure_secret: () => null,

    // ── Tauri dialog plugin (for flows guarded by confirm/message) ──
    'plugin:dialog|confirm': () => true,
    'plugin:dialog|ask': () => true,
    'plugin:dialog|message': () => null,
    'plugin:dialog|save': (args) => {
      const options = args?.options ?? {};
      return '/mock/' + (options.defaultPath || 'download');
    },

    // ── File write (내보내기 검증용) — 실제로 쓰지 않고 window에 모아둔다 ──
    write_text_file: (args) => {
      window.__MOCK_WRITTEN_FILES__ = window.__MOCK_WRITTEN_FILES__ || [];
      window.__MOCK_WRITTEN_FILES__.push({ path: args?.path, content: args?.content });
      return null;
    },
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
