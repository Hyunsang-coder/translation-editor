import { applyDesktopTranslationPreview, discardDesktopTranslationPreview } from '@/desktop/translationPreviewActions';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { searchGlossary } from '@/tauri/glossary';
import { invoke } from '@tauri-apps/api/core';
import { adfToTipTap } from '@/utils/adfToTipTap';
import type { AdfDocument } from '@/utils/adfParser';
import { hashContent } from '@/utils/hash';
import {
  htmlToTipTapJson,
  markdownToTipTapJson,
  markdownToTipTapJsonForTranslation,
  tipTapJsonToHtml,
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
      const hits = await searchGlossary({
        projectId: project.id,
        query: sourceMarkdown.slice(0, 2000),
        domain: project.metadata.domain,
        limit: 30,
      });
      if (hits.length > 0) {
        glossary = hits
          .map((entry) => `- ${entry.source} = ${entry.target}${entry.notes ? ` (${entry.notes})` : ''}`)
          .join('\n');
      }
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
  const format = params.format === 'tiptap_json' ? 'tiptap_json' : 'markdown';
  const title = typeof params.title === 'string' && params.title.trim().length > 0
    ? params.title.trim()
    : 'Claude Desktop Preview';
  const summary = typeof params.summary === 'string' ? params.summary : null;
  const intent = typeof params.intent === 'string' ? params.intent : 'external';

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

  'oddeyes.setSourceDocument': async (params) => {
    const format = typeof params?.format === 'string' ? params.format : 'markdown';
    const filePath = typeof params?.filePath === 'string' ? params.filePath : '';
    const content = params?.content;

    let tipTapJson: TipTapDocJson;

    if (filePath) {
      // 파일 경로 기반: Rust command로 파일 읽기
      const raw = await invoke<string>('read_text_file', { path: filePath });

      if (format === 'adf') {
        const adfDoc: AdfDocument = JSON.parse(raw);
        tipTapJson = adfToTipTap(adfDoc);
      } else if (format === 'tiptap_json') {
        tipTapJson = JSON.parse(raw) as TipTapDocJson;
      } else {
        // markdown
        tipTapJson = markdownToTipTapJson(raw);
      }
    } else if (content != null) {
      // content 직접 전달
      if (format === 'adf') {
        const adfDoc: AdfDocument = typeof content === 'string' ? JSON.parse(content) : content as AdfDocument;
        tipTapJson = adfToTipTap(adfDoc);
      } else if (format === 'tiptap_json') {
        tipTapJson = typeof content === 'string' ? JSON.parse(content) as TipTapDocJson : content as TipTapDocJson;
      } else {
        // markdown
        tipTapJson = markdownToTipTapJson(String(content));
      }
    } else {
      throw new Error('Either filePath or content is required.');
    }

    const html = tipTapJsonToHtml(tipTapJson);
    const { setSourceDocument, setSourceDocJson } = useProjectStore.getState();
    setSourceDocument(html);
    setSourceDocJson(tipTapJson);

    const snapshot = buildDocumentSnapshot('source', 'markdown');
    return { ok: true, sourceRevision: snapshot.revision };
  },

  'oddeyes.loadConfluencePage': async (params) => {
    const pageUrl = typeof params?.pageUrl === 'string' ? params.pageUrl : '';
    if (!pageUrl) {
      throw new Error('pageUrl is required');
    }

    // Rust command로 ADF 직접 fetch (OAuth 토큰 재사용)
    const apiResponse = await invoke<{ body?: { atlas_doc_format?: { value?: string } }; title?: string }>(
      'load_confluence_page_as_source',
      { pageUrl },
    );

    const adfRaw = apiResponse?.body?.atlas_doc_format?.value;
    if (!adfRaw) {
      throw new Error('ADF 콘텐츠를 가져올 수 없습니다.');
    }

    const adfDoc: AdfDocument = typeof adfRaw === 'string' ? JSON.parse(adfRaw) : adfRaw;
    const tipTapJson = adfToTipTap(adfDoc);
    const html = tipTapJsonToHtml(tipTapJson);

    const { setSourceDocument, setSourceDocJson } = useProjectStore.getState();
    setSourceDocument(html);
    setSourceDocJson(tipTapJson);

    return { ok: true, pageUrl };
  },
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
