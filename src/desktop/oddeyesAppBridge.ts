import { applyDesktopTranslationPreview, discardDesktopTranslationPreview } from '@/desktop/translationPreviewActions';
import { useChatStore } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGlossaryStore } from '@/stores/glossaryStore';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore, type IssueType, type IssueSeverity } from '@/stores/reviewStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { resolveDirection } from '@/utils/detectLanguage';
import { resolveGlossaryForPrompt } from '@/utils/glossaryInject';
import { hashContent } from '@/utils/hash';
import {
  htmlToTipTapJson,
  markdownToTipTapJsonForTranslation,
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from '@/utils/markdownConverter';
import type {
  ForbiddenTerm,
  ProjectMemoryCategory,
  ProjectMemoryItem,
  ProjectMemoryStatus,
} from '@/types';

type BridgeParams = Record<string, unknown>;

interface DocumentSnapshot {
  format: 'markdown' | 'tiptap_json';
  content: string | TipTapDocJson;
  revision: string;
  empty: boolean;
}

declare global {
  interface Window {
    __ODDEYES_APP_BRIDGE__?: {
      handleRequest: (method: string, params?: BridgeParams) => Promise<unknown>;
    };
  }
}

function getDocJson(kind: 'source' | 'target'): TipTapDocJson {
  // 살아있는 에디터가 최우선: 스토어의 DocJson/HTML 캐시는 에디터 onChange 디바운스(P1)로
  // 최대 수백 ms 뒤처질 수 있다. revision(set 시점)과 apply 시점 재검증(L3)이 같은 소스를
  // 보도록 에디터 → 스토어 JSON → 스토어 HTML 순으로 읽는다.
  const { sourceEditor, targetEditor } = useEditorStore.getState();
  const editor = kind === 'source' ? sourceEditor : targetEditor;
  if (editor && !editor.isDestroyed) {
    try {
      return editor.getJSON() as TipTapDocJson;
    } catch {
      // 직렬화 실패 시 스토어 캐시로 폴백
    }
  }

  const projectStore = useProjectStore.getState();
  const direct = kind === 'source' ? projectStore.sourceDocJson : projectStore.targetDocJson;
  if (direct) {
    return direct;
  }

  const html = kind === 'source' ? projectStore.sourceDocument : projectStore.targetDocument;
  return htmlToTipTapJson(html || '');
}

function buildDocumentSnapshot(kind: 'source' | 'target', format: 'markdown' | 'tiptap_json'): DocumentSnapshot {
  const docJson = getDocJson(kind);
  const markdown = tipTapJsonToMarkdownForTranslation(docJson);
  const revision = hashContent(markdown);

  if (format === 'tiptap_json') {
    return {
      format,
      content: docJson,
      revision,
      empty: markdown.trim().length === 0,
    };
  }

  return {
    format,
    content: markdown,
    revision,
    empty: markdown.trim().length === 0,
  };
}

function assertRevision(kind: 'source' | 'target', expected?: unknown): string {
  const current = buildDocumentSnapshot(kind, 'markdown').revision;
  if (typeof expected === 'string' && expected.length > 0 && current !== expected) {
    throw new Error(`${kind} document revision mismatch.`);
  }
  return current;
}

async function getTranslationContext(): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) {
    throw new Error('No active project.');
  }

  const chatStore = useChatStore.getState();
  const sourceMarkdown = buildDocumentSnapshot('source', 'markdown').content as string;

  let glossary = '';
  try {
    if (sourceMarkdown.trim().length > 0) {
      glossary = await resolveGlossaryForPrompt({
        projectId: project.id,
        text: sourceMarkdown,
        domain: project.metadata.domain,
        limit: 30,
      });
    }
  } catch {
    glossary = '';
  }

  // 앱이 실제로 프롬프트에 넣는 것과 같은 것만 돌려준다: 승인된(active) 프로젝트 메모리와
  // 켜져 있는 금칙어. legacy projectContext는 v2.13.0부터 프롬프트에 주입되지 않으므로
  // 노출하지 않는다 (읽으면 외부 에이전트가 죽은 값을 근거로 삼는다).
  await ensureProjectMemory(project.id);
  const memory = useProjectMemoryStore.getState();

  return {
    projectId: project.id,
    projectTitle: project.metadata.title,
    ...directionWire(project.metadata, sourceMarkdown),
    translationRules: chatStore.translationRules || '',
    projectMemory: memory.items
      .filter((item) => item.status === 'active')
      .map(toMemoryWire),
    forbiddenTerms: memory.forbiddenTerms
      .filter((term) => term.enabled)
      .map(toForbiddenTermWire),
    revision: memory.revision,
    glossary,
  };
}

async function setTranslationPreview(params: BridgeParams): Promise<unknown> {
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;
  if (!project) throw new Error('No project loaded');

  // 외부 호출자가 projectId를 넘기면 현재 프로젝트와 일치해야 한다 (setReviewIssues와 대칭).
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }

  const format = params.format === 'tiptap_json' ? 'tiptap_json' : 'markdown';
  const title = typeof params.title === 'string' && params.title.trim().length > 0
    ? params.title.trim()
    : 'Claude Desktop Preview';
  const summary = typeof params.summary === 'string' ? params.summary : null;
  const intent = typeof params.intent === 'string' ? params.intent : 'external';

  // L3: revision은 호출자가 넘기면 검증하고, 안 넘기면 set 시점 현재값을 자동 캡처한다.
  // projectId도 마찬가지로 set 시점의 현재 프로젝트를 항상 기록한다. 이 두 값은
  // applyDesktopTranslationPreview가 apply 시점에 재검증하는 기준이 된다.
  // (외부 MCP 파라미터 스키마의 필수화는 oddeyes-desktop-mcp/Rust 쪽 변경이 필요하므로,
  //  하위 호환을 위해 미전달 시 자동 캡처 방식을 사용한다.)
  const sourceRevision = assertRevision('source', params.sourceRevision);
  const targetRevision = assertRevision('target', params.targetRevision);
  const docJson = format === 'tiptap_json'
    ? params.content as TipTapDocJson
    : markdownToTipTapJsonForTranslation(String(params.content ?? ''));

  useTranslationPreviewStore.getState().setPreview({
    title,
    docJson,
    sourceHtml: projectStore.sourceDocument,
    originalHtml: projectStore.targetDocument,
    sourceRevision,
    targetRevision,
    summary,
    intent: intent as 'translate' | 'revise' | 'review_fix' | 'external',
    projectId: project.id,
  });

  return {
    ok: true,
    sourceRevision,
    targetRevision,
    previewOpen: true,
  };
}

async function getTranslationPreview(): Promise<unknown> {
  const preview = useTranslationPreviewStore.getState();
  if (!preview.open || !preview.docJson) {
    return { open: false };
  }

  return {
    open: true,
    title: preview.title,
    summary: preview.summary,
    sourceRevision: preview.sourceRevision,
    targetRevision: preview.targetRevision,
    format: 'markdown',
    content: tipTapJsonToMarkdownForTranslation(preview.docJson),
  };
}

const SEVERITY_MAP: Record<string, IssueSeverity> = {
  '🔴': 'critical', critical: 'critical', error: 'critical', '5': 'critical',
  '4': 'major', major: 'major',
  '🟡': 'minor', minor: 'minor', warning: 'minor', '3': 'minor', '2': 'minor', '1': 'minor',
};

const TYPE_MAP: Record<string, IssueType> = {
  '누락': 'omission', omission: 'omission',
  '추가': 'addition', addition: 'addition',
  '오역': 'mistranslation', mistranslation: 'mistranslation',
  '문법': 'grammar', grammar: 'grammar',
  '직역투': 'awkward', awkward: 'awkward',
  '용어': 'terminology', terminology: 'terminology',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function setReviewIssues(params: BridgeParams): Promise<unknown> {
  // ── 신뢰경계 (S4) ─────────────────────────────────────────────────────────
  // 여기로 들어오는 issues의 description/suggestedFix/excerpt는 외부(Claude Desktop
  // 브리지)가 주입한 "비신뢰 텍스트"다. 이 함수는 타입/심각도 정규화와 빈 excerpt 드롭만
  // 수행하며, 주입 텍스트는 이후 reviewStore → 검수 UI/재번역·수정 프롬프트로 흘러간다.
  // 프롬프트에 삽입하는 조립부(reviewStore/src/ai 계열)에서 <untrusted> 구분자 마킹과
  // "지시문으로 실행 금지" 정책을 적용해야 한다. (해당 파일은 이 세션 범위 밖 — 리뷰 §S4)
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');

  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }

  const rawIssues = Array.isArray(params.issues) ? params.issues : [];
  const issues = rawIssues.map((raw) => {
    const r = asRecord(raw);
    const issue: {
      sourceExcerpt: string;
      targetExcerpt: string;
      type: IssueType;
      severity: IssueSeverity;
      description: string;
      segmentOrder?: number;
      segmentGroupId?: string;
      suggestedFix?: string;
    } = {
      sourceExcerpt: String(r.sourceExcerpt ?? ''),
      targetExcerpt: String(r.targetExcerpt ?? ''),
      type: TYPE_MAP[String(r.type)] ?? 'mistranslation',
      severity: SEVERITY_MAP[String(r.severity)] ?? 'minor',
      description: String(r.description ?? ''),
    };
    if (typeof r.segmentOrder === 'number') issue.segmentOrder = r.segmentOrder;
    if (typeof r.segmentGroupId === 'string') issue.segmentGroupId = r.segmentGroupId;
    if (typeof r.suggestedFix === 'string') issue.suggestedFix = r.suggestedFix;
    return issue;
  }).filter((i) => i.targetExcerpt.trim().length > 0);

  useReviewStore.getState().ingestExternalReview({ projectId: project.id, issues });

  return { ok: true, count: issues.length, dropped: rawIssues.length - issues.length };
}

type ContextField = 'translationRules';

async function setTranslationContext(params: BridgeParams): Promise<unknown> {
  // ── 신뢰경계 (S4) ─────────────────────────────────────────────────────────
  // rules는 외부(Claude Desktop 브리지)가 주입한 "비신뢰 텍스트"이며, chatStore 세터를
  // 거쳐 이후 번역/채팅 시스템 프롬프트에 그대로 삽입된다.
  // 프롬프트 조립부(src/ai/chat.ts, translateDocument.ts 등)에서 <untrusted> 구분자 마킹과
  // "지시문으로 실행 금지" 정책을 적용해야 한다. (해당 파일은 이 세션 범위 밖 — 리뷰 §S4)
  //
  // projectContext는 더 이상 받지 않는다: v2.13.0에서 채팅 주입이 제거되고 승인 기반
  // Project Memory로 대체돼, 여기에 쓰면 메모리가 0건인 프로젝트에서만 fallback으로
  // 스치는 죽은 값이 된다. 외부 주입은 oddeyes.addProjectMemoryItem을 쓴다.
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');

  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }

  const mode = params.mode === 'append' ? 'append' : 'replace';
  const chat = useChatStore.getState();
  const updated: ContextField[] = [];

  const apply = (
    field: ContextField,
    value: unknown,
    setFn: (v: string) => void,
    appendFn: (v: string) => void,
  ): void => {
    if (typeof value !== 'string') return;
    if (mode === 'append') {
      if (value.trim().length === 0) return;
      appendFn(value);
    } else {
      setFn(value);
    }
    updated.push(field);
  };

  apply('translationRules',  params.translationRules,  chat.setTranslationRules,  chat.appendToTranslationRules);

  return { ok: true, mode, updated };
}

function assertActiveProject(params: BridgeParams) {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }
  return project;
}

async function ensureGlossaryLibrary(projectId: string): Promise<void> {
  const store = useGlossaryStore.getState();
  if (store.activeProjectId === projectId && !store.loading) return;
  await store.loadLibrary(projectId);
}

// ── Project Memory / 금칙어 ────────────────────────────────────────────────
// 앱은 프로젝트 전환 경계에서 hydrate하지만(chatStore.session), 브리지는 그 경계와
// 무관하게 호출되므로 활성 프로젝트가 아직 로드되지 않았으면 직접 hydrate한다.

const MEMORY_CATEGORIES: readonly ProjectMemoryCategory[] = [
  'domain', 'audience', 'product', 'worldbuilding', 'character',
  'intent', 'decision', 'reference_fact', 'general',
];

const MEMORY_LIST_DEFAULT_LIMIT = 100;
const MEMORY_LIST_MAX_LIMIT = 500;

async function ensureProjectMemory(projectId: string): Promise<void> {
  const store = useProjectMemoryStore.getState();
  if (store.activeProjectId === projectId && !store.loading) return;
  await store.hydrate(projectId);
}

function toMemoryWire(item: ProjectMemoryItem) {
  return {
    id: item.id,
    category: item.category,
    content: item.content,
    status: item.status,
    source: item.source,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toForbiddenTermWire(term: ForbiddenTerm) {
  return {
    id: term.id,
    term: term.term,
    replacement: term.replacement ?? null,
    note: term.note ?? null,
    enabled: term.enabled,
  };
}

function parseMemoryCategory(raw: unknown): ProjectMemoryCategory {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return 'general';
  if (!MEMORY_CATEGORIES.includes(value as ProjectMemoryCategory)) {
    throw new Error(`Unknown category: ${value}. Allowed: ${MEMORY_CATEGORIES.join(', ')}`);
  }
  return value as ProjectMemoryCategory;
}

function parseListLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

function requireContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content) throw new Error('content is required.');
  return content;
}

async function listProjectMemoryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const store = useProjectMemoryStore.getState();

  const status = typeof params.status === 'string' ? params.status : 'active';
  const category = typeof params.category === 'string' && params.category.trim()
    ? parseMemoryCategory(params.category)
    : null;
  const query = typeof params.query === 'string' ? params.query.trim().toLocaleLowerCase() : '';
  const limit = parseListLimit(params.limit, MEMORY_LIST_DEFAULT_LIMIT, MEMORY_LIST_MAX_LIMIT);

  const matched = store.items
    .filter((item) => status === 'all' || item.status === (status as ProjectMemoryStatus))
    .filter((item) => !category || item.category === category)
    .filter((item) => !query || item.content.toLocaleLowerCase().includes(query));
  const items = matched.slice(0, limit);

  return {
    ok: true,
    projectId: project.id,
    revision: store.revision,
    status,
    category,
    query: query || null,
    limit,
    total: matched.length,
    truncated: matched.length > items.length,
    items: items.map(toMemoryWire),
    forbiddenTerms: store.forbiddenTerms.map(toForbiddenTermWire),
  };
}

async function addProjectMemoryItemBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const result = await useProjectMemoryStore.getState().addItem({
    category: parseMemoryCategory(params.category),
    content: requireContent(params.content),
    // 외부 반입은 source='import'로 남긴다 — Settings의 프로젝트 메모리 목록에 출처가
    // 그대로 보이고, 사용자가 직접 삭제할 수 있다.
    source: 'import',
    status: 'active',
  });
  return {
    ok: true,
    projectId: project.id,
    item: toMemoryWire(result.item),
    revision: result.revision,
    duplicate: result.duplicate,
  };
}

async function replaceProjectMemoryItemBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const targetItemId = typeof params.targetItemId === 'string' ? params.targetItemId.trim() : '';
  if (!targetItemId) throw new Error('targetItemId is required.');

  const store = useProjectMemoryStore.getState();
  const target = store.items.find((item) => item.id === targetItemId);
  if (!target) throw new Error(`Unknown memory item: ${targetItemId}`);

  const result = await store.replaceItem(targetItemId, {
    category: typeof params.category === 'string' && params.category.trim()
      ? parseMemoryCategory(params.category)
      : target.category,
    content: requireContent(params.content),
    source: 'import',
    status: 'active',
  });
  return {
    ok: true,
    projectId: project.id,
    item: toMemoryWire(result.item),
    revision: result.revision,
  };
}

async function deleteProjectMemoryItemBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const itemId = typeof params.itemId === 'string' ? params.itemId.trim() : '';
  if (!itemId) throw new Error('itemId is required.');

  const store = useProjectMemoryStore.getState();
  if (!store.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown memory item: ${itemId}`);
  }

  await store.deleteItem(itemId);
  return {
    ok: true,
    projectId: project.id,
    itemId,
    revision: useProjectMemoryStore.getState().revision,
  };
}

async function upsertForbiddenTermBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const term = typeof params.term === 'string' ? params.term.trim() : '';
  if (!term) throw new Error('term is required.');

  const id = typeof params.id === 'string' ? params.id.trim() : '';
  if (id && !useProjectMemoryStore.getState().forbiddenTerms.some((item) => item.id === id)) {
    throw new Error(`Unknown forbidden term: ${id}`);
  }

  const replacement = typeof params.replacement === 'string' ? params.replacement.trim() : '';
  const note = typeof params.note === 'string' ? params.note.trim() : '';
  const result = await useProjectMemoryStore.getState().saveForbiddenTerm({
    ...(id ? { id } : {}),
    term,
    ...(replacement ? { replacement } : {}),
    ...(note ? { note } : {}),
    enabled: params.enabled === undefined ? true : params.enabled === true,
  });
  return {
    ok: true,
    projectId: project.id,
    term: toForbiddenTermWire(result.term),
    revision: result.revision,
  };
}

async function deleteForbiddenTermBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureProjectMemory(project.id);
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  if (!id) throw new Error('id is required.');
  if (!useProjectMemoryStore.getState().forbiddenTerms.some((item) => item.id === id)) {
    throw new Error(`Unknown forbidden term: ${id}`);
  }

  await useProjectMemoryStore.getState().removeForbiddenTerm(id);
  return {
    ok: true,
    projectId: project.id,
    id,
    revision: useProjectMemoryStore.getState().revision,
  };
}

async function listProjectGlossariesBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const { projectGlossaries, glossaries } = useGlossaryStore.getState();
  return {
    ok: true,
    projectId: project.id,
    projectGlossaries,
    glossaries,
  };
}

const GLOSSARY_ENTRY_LIST_DEFAULT_LIMIT = 100;
const GLOSSARY_ENTRY_LIST_MAX_LIMIT = 500;

function resolveKnownGlossaryId(glossaryId: string | null): string {
  if (!glossaryId) {
    throw new Error('glossaryId is required.');
  }
  const store = useGlossaryStore.getState();
  const known = store.glossaries.some((item) => item.id === glossaryId)
    || store.projectGlossaries.some((item) => item.id === glossaryId);
  if (!known) {
    throw new Error(`Unknown glossaryId: ${glossaryId}`);
  }
  return glossaryId;
}

function parseEntryListLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return GLOSSARY_ENTRY_LIST_DEFAULT_LIMIT;
  }
  const n = Math.floor(raw);
  if (n < 1) return GLOSSARY_ENTRY_LIST_DEFAULT_LIMIT;
  return Math.min(n, GLOSSARY_ENTRY_LIST_MAX_LIMIT);
}

/**
 * 현재 프로젝트 용어집에 엔트리를 추가한다.
 * glossaryId 생략 시 연결된 첫 용어집을 쓰고, 없으면 새 용어집을 만들어 연결한다.
 * createEntry가 미연결 glossary도 자동 링크한다.
 */
async function addGlossaryEntryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  const source = typeof params.source === 'string' ? params.source.trim() : '';
  const target = typeof params.target === 'string' ? params.target.trim() : '';
  if (!source || !target) {
    throw new Error('source and target are required.');
  }

  await ensureGlossaryLibrary(project.id);

  let glossaryId = typeof params.glossaryId === 'string' && params.glossaryId.trim()
    ? params.glossaryId.trim()
    : null;
  let createdGlossary = false;

  const store = useGlossaryStore.getState();
  if (glossaryId) {
    resolveKnownGlossaryId(glossaryId);
  } else {
    glossaryId = store.projectGlossaries[0]?.id ?? null;
  }

  if (!glossaryId) {
    const name = typeof params.glossaryName === 'string' && params.glossaryName.trim()
      ? params.glossaryName.trim()
      : 'Project glossary';
    const created = await useGlossaryStore.getState().createGlossary(name);
    glossaryId = created.id;
    createdGlossary = true;
    await useGlossaryStore.getState().saveProjectSelection(project.id, [created.id]);
  }

  const wasLinked = useGlossaryStore.getState().projectGlossaries
    .some((item) => item.id === glossaryId);
  const notes = typeof params.notes === 'string' ? params.notes.trim() || null : null;
  const entry = await useGlossaryStore.getState().createEntry({
    glossaryId,
    source,
    target,
    notes,
    domain: project.metadata.domain ?? null,
    caseSensitive: params.caseSensitive === true,
  });
  const linkedToProject = wasLinked
    || useGlossaryStore.getState().projectGlossaries.some((item) => item.id === glossaryId);

  return {
    ok: true,
    entry,
    glossaryId,
    createdGlossary,
    linkedToProject,
  };
}

async function listGlossaryEntriesBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const glossaryId = resolveKnownGlossaryId(
    typeof params.glossaryId === 'string' ? params.glossaryId.trim() : null,
  );
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const limit = parseEntryListLimit(params.limit);

  await useGlossaryStore.getState().loadEntries(
    glossaryId,
    query.length > 0 ? query : undefined,
  );
  const all = useGlossaryStore.getState().entriesByGlossary[glossaryId] ?? [];
  const entries = all.slice(0, limit);
  return {
    ok: true,
    projectId: project.id,
    glossaryId,
    query: query || null,
    limit,
    total: all.length,
    truncated: all.length > entries.length,
    entries,
  };
}

async function updateGlossaryEntryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const glossaryId = resolveKnownGlossaryId(
    typeof params.glossaryId === 'string' ? params.glossaryId.trim() : null,
  );
  const entryId = typeof params.entryId === 'string' ? params.entryId.trim() : '';
  if (!entryId) throw new Error('entryId is required.');

  const source = typeof params.source === 'string' ? params.source.trim() : '';
  const target = typeof params.target === 'string' ? params.target.trim() : '';
  if (!source || !target) {
    throw new Error('source and target are required.');
  }

  const notes = typeof params.notes === 'string' ? params.notes.trim() || null : null;
  const entry = await useGlossaryStore.getState().updateEntry({
    glossaryId,
    entryId,
    source,
    target,
    notes,
    domain: project.metadata.domain ?? null,
    caseSensitive: params.caseSensitive === true,
  });
  return { ok: true, entry, glossaryId };
}

async function deleteGlossaryEntryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const glossaryId = resolveKnownGlossaryId(
    typeof params.glossaryId === 'string' ? params.glossaryId.trim() : null,
  );
  const entryId = typeof params.entryId === 'string' ? params.entryId.trim() : '';
  if (!entryId) throw new Error('entryId is required.');

  await useGlossaryStore.getState().deleteEntry(glossaryId, entryId);
  return { ok: true, glossaryId, entryId, projectId: project.id };
}

async function linkProjectGlossaryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const glossaryId = resolveKnownGlossaryId(
    typeof params.glossaryId === 'string' ? params.glossaryId.trim() : null,
  );
  const store = useGlossaryStore.getState();
  if (store.projectGlossaries.some((item) => item.id === glossaryId)) {
    return {
      ok: true,
      projectId: project.id,
      glossaryId,
      alreadyLinked: true,
      projectGlossaries: store.projectGlossaries,
    };
  }
  const nextIds = [...store.projectGlossaries.map((item) => item.id), glossaryId];
  await store.saveProjectSelection(project.id, nextIds);
  return {
    ok: true,
    projectId: project.id,
    glossaryId,
    alreadyLinked: false,
    projectGlossaries: useGlossaryStore.getState().projectGlossaries,
  };
}

async function unlinkProjectGlossaryBridge(params: BridgeParams): Promise<unknown> {
  const project = assertActiveProject(params);
  await ensureGlossaryLibrary(project.id);
  const glossaryId = resolveKnownGlossaryId(
    typeof params.glossaryId === 'string' ? params.glossaryId.trim() : null,
  );
  const store = useGlossaryStore.getState();
  if (!store.projectGlossaries.some((item) => item.id === glossaryId)) {
    return {
      ok: true,
      projectId: project.id,
      glossaryId,
      alreadyUnlinked: true,
      projectGlossaries: store.projectGlossaries,
    };
  }
  const nextIds = store.projectGlossaries
    .filter((item) => item.id !== glossaryId)
    .map((item) => item.id);
  await store.saveProjectSelection(project.id, nextIds);
  return {
    ok: true,
    projectId: project.id,
    glossaryId,
    alreadyUnlinked: false,
    projectGlossaries: useGlossaryStore.getState().projectGlossaries,
  };
}

const methods: Record<string, (params?: BridgeParams) => Promise<unknown>> = {
  'oddeyes.getStatus': async () => {
    const project = useProjectStore.getState().project;
    const source = buildDocumentSnapshot('source', 'markdown');
    const target = buildDocumentSnapshot('target', 'markdown');
    const preview = useTranslationPreviewStore.getState();
    // 프로젝트 지식은 여기서 hydrate하지 않는다(상태 조회는 가볍게 유지). 아직 로드 전이면
    // null을 돌려 "0건"으로 오독되지 않게 한다.
    const memory = useProjectMemoryStore.getState();
    const memoryLoaded = project !== null && memory.activeProjectId === project.id;
    return {
      ready: project !== null,
      projectId: project?.id ?? null,
      projectTitle: project?.metadata.title ?? null,
      // 저장값이 아니라 **해석된** 언어를 내보낸다 — 센티널 'auto'를 그대로 주면
      // 외부 에이전트의 방향 교차검증(expectedDir)이 통째로 꺼진다.
      ...directionWire(
        project?.metadata,
        typeof source.content === 'string' ? source.content : '',
      ),
      sourceRevision: source.revision,
      targetRevision: target.revision,
      sourceEmpty: source.empty,
      targetEmpty: target.empty,
      previewOpen: preview.open,
      projectMemoryRevision: memoryLoaded ? memory.revision : null,
      projectMemoryActiveCount: memoryLoaded
        ? memory.items.filter((item) => item.status === 'active').length
        : null,
      forbiddenTermEnabledCount: memoryLoaded
        ? memory.forbiddenTerms.filter((term) => term.enabled).length
        : null,
    };
  },

  'oddeyes.getSource': async (params) => {
    const format = params?.format === 'tiptap_json' ? 'tiptap_json' : 'markdown';
    return buildDocumentSnapshot('source', format);
  },

  'oddeyes.getTarget': async (params) => {
    const format = params?.format === 'tiptap_json' ? 'tiptap_json' : 'markdown';
    return buildDocumentSnapshot('target', format);
  },

  'oddeyes.getTranslationContext': async () => await getTranslationContext(),
  'oddeyes.setTranslationPreview': async (params) => await setTranslationPreview(params ?? {}),
  'oddeyes.getTranslationPreview': async () => await getTranslationPreview(),
  'oddeyes.applyTranslationPreview': async () => {
    await applyDesktopTranslationPreview();
    return { ok: true };
  },
  'oddeyes.discardTranslationPreview': async () => {
    discardDesktopTranslationPreview();
    return { ok: true };
  },

  'oddeyes.setReviewIssues': async (params) => await setReviewIssues(params ?? {}),
  'oddeyes.setTranslationContext': async (params) => await setTranslationContext(params ?? {}),


  'oddeyes.listProjectMemory': async (params) => await listProjectMemoryBridge(params ?? {}),
  'oddeyes.addProjectMemoryItem': async (params) => await addProjectMemoryItemBridge(params ?? {}),
  'oddeyes.replaceProjectMemoryItem': async (params) => await replaceProjectMemoryItemBridge(params ?? {}),
  'oddeyes.deleteProjectMemoryItem': async (params) => await deleteProjectMemoryItemBridge(params ?? {}),
  'oddeyes.upsertForbiddenTerm': async (params) => await upsertForbiddenTermBridge(params ?? {}),
  'oddeyes.deleteForbiddenTerm': async (params) => await deleteForbiddenTermBridge(params ?? {}),

  'oddeyes.listProjectGlossaries': async (params) => await listProjectGlossariesBridge(params ?? {}),
  'oddeyes.addGlossaryEntry': async (params) => await addGlossaryEntryBridge(params ?? {}),
  'oddeyes.listGlossaryEntries': async (params) => await listGlossaryEntriesBridge(params ?? {}),
  'oddeyes.updateGlossaryEntry': async (params) => await updateGlossaryEntryBridge(params ?? {}),
  'oddeyes.deleteGlossaryEntry': async (params) => await deleteGlossaryEntryBridge(params ?? {}),
  'oddeyes.linkProjectGlossary': async (params) => await linkProjectGlossaryBridge(params ?? {}),
  'oddeyes.unlinkProjectGlossary': async (params) => await unlinkProjectGlossaryBridge(params ?? {}),

};

/**
 * 외부 에이전트에 나가는 방향 두 필드. 저장 센티널이 아니라 해석값을 내보낸다 —
 * null은 "설정으로도 원문으로도 결정 못 함"을 뜻한다.
 */
function directionWire(
  metadata: { sourceLanguage?: string | undefined; targetLanguage?: string | undefined } | undefined,
  sourceText: string,
): { sourceLanguage: string | null; targetLanguage: string | null } {
  const direction = resolveDirection(
    { source: metadata?.sourceLanguage, target: metadata?.targetLanguage },
    sourceText,
  );
  return { sourceLanguage: direction.source.language, targetLanguage: direction.target.language };
}

export function initializeOddEyesAppBridge(): void {
  window.__ODDEYES_APP_BRIDGE__ = {
    async handleRequest(method: string, params: BridgeParams = {}): Promise<unknown> {
      const handler = methods[method];
      if (!handler) {
        throw new Error(`Method not found: ${method}`);
      }
      return await handler(params);
    },
  };
}
