import { applyDesktopTranslationPreview, discardDesktopTranslationPreview } from '@/desktop/translationPreviewActions';
import { useChatStore } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGlossaryStore } from '@/stores/glossaryStore';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore, type IssueType, type IssueSeverity } from '@/stores/reviewStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { resolveGlossaryForPrompt } from '@/utils/glossaryInject';
import {
  getQualityRecords,
  logQualityRecords,
  recordIssuesProposed,
  type QualityRecordFilter,
  type QualityRecordInput,
  type ReviewLedgerContext,
} from '@/quality';
import { hashContent } from '@/utils/hash';
import {
  htmlToTipTapJson,
  markdownToTipTapJsonForTranslation,
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from '@/utils/markdownConverter';

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

  return {
    projectId: project.id,
    projectTitle: project.metadata.title,
    targetLanguage: project.metadata.targetLanguage ?? null,
    translationRules: chatStore.translationRules || '',
    projectContext: chatStore.projectContext || '',
    translatorPersona: chatStore.translatorPersona || '',
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

  // 품질 장부: 외부(에이전트) 반입 이슈를 proposed로 적재 (executor=claude_agent, WP-A1 요구사항 2-④)
  // 정규화된 이슈(결정론적 id 포함)를 store에서 읽어 origin을 채운다. best-effort —
  // 기록 실패가 반입 자체를 막지 않도록 완전히 격리한다.
  try {
    const getAll = useReviewStore.getState().getAllIssues;
    const normalized = typeof getAll === 'function' ? getAll() : [];
    if (normalized.length > 0) {
      const ctx: ReviewLedgerContext = {
        stage: 's1_translate',
        caughtBy: 'review_agent',
        executor: 'claude_agent',
        direction: null,
        contentType: project.metadata.domain ?? null,
        reviewerModel: null,
        producerModel: null,
      };
      void recordIssuesProposed(project.id, normalized, ctx);
    }
  } catch (err) {
    console.warn('[quality-ledger] setReviewIssues ledger log skipped (best-effort):', err);
  }

  return { ok: true, count: issues.length, dropped: rawIssues.length - issues.length };
}

type ContextField = 'translatorPersona' | 'translationRules' | 'projectContext';

async function setTranslationContext(params: BridgeParams): Promise<unknown> {
  // ── 신뢰경계 (S4) ─────────────────────────────────────────────────────────
  // persona/rules/projectContext는 외부(Claude Desktop 브리지)가 주입한 "비신뢰 텍스트"이며,
  // chatStore 세터를 거쳐 이후 번역/채팅 시스템 프롬프트에 그대로 삽입된다.
  // 프롬프트 조립부(src/ai/chat.ts, translateDocument.ts 등)에서 <untrusted> 구분자 마킹과
  // "지시문으로 실행 금지" 정책을 적용해야 한다. (해당 파일은 이 세션 범위 밖 — 리뷰 §S4)
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

  apply('translatorPersona', params.translatorPersona, chat.setTranslatorPersona, chat.appendToTranslatorPersona);
  apply('translationRules',  params.translationRules,  chat.setTranslationRules,  chat.appendToTranslationRules);
  apply('projectContext',    params.projectContext,    chat.setProjectContext,    chat.appendToProjectContext);

  return { ok: true, mode, updated };
}

/**
 * 품질 장부에 §4.1 레코드 배열을 push (§4.7 #1 oddeyes_log_quality_records).
 * 앱이 id·created_at을 발급하고 저장 개수를 반환한다. 에이전트가 mono-review 판정
 * (채택·반려 포함)을 기록하는 통로다.
 */
async function logQualityRecordsBridge(params: BridgeParams): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }
  const rawRecords = Array.isArray(params.records) ? params.records : [];
  // 에이전트가 §4.1 형태(중첩 객체)로 보내는 것을 신뢰하되, 최소 형태만 방어적으로 검증.
  const inputs: QualityRecordInput[] = rawRecords
    .map((raw) => asRecord(raw) as unknown as QualityRecordInput)
    .filter((r) => r.finding && r.origin && r.segment && r.disposition);
  const saved = await logQualityRecords(project.id, inputs);
  return { ok: true, count: saved.length, dropped: rawRecords.length - saved.length };
}

/**
 * 품질 장부를 필터로 조회 (§4.7 #2 oddeyes_get_quality_records). 마이닝(WP-B5)의 입력.
 */
async function getQualityRecordsBridge(params: BridgeParams): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }
  const raw = asRecord(params.filter);
  const filter: QualityRecordFilter = {};
  if (typeof raw.since === 'number') filter.since = raw.since;
  if (typeof raw.stage === 'string') filter.stage = raw.stage;
  if (typeof raw.disposition === 'string') filter.disposition = raw.disposition;
  if (typeof raw.promotionStatus === 'string') filter.promotionStatus = raw.promotionStatus;
  if (typeof raw.limit === 'number') filter.limit = raw.limit;
  const records = await getQualityRecords(project.id, filter);
  return { ok: true, count: records.length, records };
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
    const known = store.glossaries.some((item) => item.id === glossaryId)
      || store.projectGlossaries.some((item) => item.id === glossaryId);
    if (!known) {
      throw new Error(`Unknown glossaryId: ${glossaryId}`);
    }
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

const methods: Record<string, (params?: BridgeParams) => Promise<unknown>> = {
  'oddeyes.getStatus': async () => {
    const project = useProjectStore.getState().project;
    const source = buildDocumentSnapshot('source', 'markdown');
    const target = buildDocumentSnapshot('target', 'markdown');
    const preview = useTranslationPreviewStore.getState();
    return {
      ready: project !== null,
      projectId: project?.id ?? null,
      projectTitle: project?.metadata.title ?? null,
      targetLanguage: project?.metadata.targetLanguage ?? null,
      sourceRevision: source.revision,
      targetRevision: target.revision,
      sourceEmpty: source.empty,
      targetEmpty: target.empty,
      previewOpen: preview.open,
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

  'oddeyes.logQualityRecords': async (params) => await logQualityRecordsBridge(params ?? {}),
  'oddeyes.getQualityRecords': async (params) => await getQualityRecordsBridge(params ?? {}),

  'oddeyes.listProjectGlossaries': async (params) => await listProjectGlossariesBridge(params ?? {}),
  'oddeyes.addGlossaryEntry': async (params) => await addGlossaryEntryBridge(params ?? {}),

};

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
