import { applyDesktopTranslationPreview, discardDesktopTranslationPreview } from '@/desktop/translationPreviewActions';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { searchGlossary } from '@/tauri/glossary';
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
