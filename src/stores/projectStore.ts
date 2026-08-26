import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  ITEProject,
  EditorBlock,
  SegmentGroup,
  BlockType,
  ProjectMetadata,
  DiffResult,
  EditSession,
} from '@/types';
import type { TipTapDocJson } from '@/ai/translateDocument';
import { hashContent, stripHtml } from '@/utils/hash';
import { loadProject as tauriLoadProject, saveProject as tauriSaveProject } from '@/tauri/project';
import { listProjectIds as tauriListProjectIds } from '@/tauri/storage';
import { loadComments, saveComments } from '@/tauri/comments';
import { createDiffResult, diffToHtml, applyDiff } from '@/utils/diff';
import { buildTargetDocument } from '@/editor/targetDocument';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { htmlToTipTapJson } from '@/utils/markdownConverter';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { useCommentStore } from '@/stores/commentStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';

// ============================================
// Store State Interface
// ============================================

interface ProjectState {
  project: ITEProject | null;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
  lastProjectId: string | null;
  lastChangeAt: number;
  lastSavedAt: number;
  saveStatus: 'idle' | 'saving' | 'error';
  lastSaveError: string | null;
  pendingDiffs: Record<string, DiffResult & { originalHtml: string }>;
  /**
   * Target 단일 문서(plain text)
   * - 현재는 blocks/segments에서 파생되며, 단일 Monaco 에디터로 편집됩니다.
   * - 저장 브릿지는 이후 단계(tracked ranges)에서 연결됩니다.
   */
  targetDocument: string;
  /**
   * Source 단일 문서(plain text, 편집 가능)
   * - 기본은 blocks에서 파생되지만, UI 편집본을 별도 보관합니다.
   */
  sourceDocument: string;

  /**
   * TipTap JSON (Source) - AI 도구용 캐시
   * - TipTap 에디터에서 변경 시 업데이트됨
   * - generateText()로 plain text 추출 가능 (stripHtml보다 성능 우수)
   */
  sourceDocJson: TipTapDocJson | null;

  /**
   * TipTap JSON (Target) - AI 도구용 캐시
   * - TipTap 에디터에서 변경 시 업데이트됨
   * - generateText()로 plain text 추출 가능 (stripHtml보다 성능 우수)
   */
  targetDocJson: TipTapDocJson | null;

  /**
   * Pending Edit 세션 기록
   */
  editSessions: EditSession[];

  /**
   * Monaco tracked ranges 기반 저장 브릿지용 핸들(비영속/비직렬화)
   */
  targetDocHandle: null | {
    getBlockOffsets: () => Record<string, { startOffset: number; endOffset: number }>;
    getDecorationOffsets?: (
      decorationId: string,
    ) => { startOffset: number; endOffset: number } | null;
    getSelection?: () => {
      startOffset: number;
      endOffset: number;
      text: string;
    } | null;
    createAnchorDecoration?: (
      startOffset: number,
      endOffset: number,
    ) => string | null;
    removeDecoration?: (decorationId: string) => void;
  };

  /**
   * Apply 요청 시점의 anchor 정보 (응답 도착 전까지 유지)
   * - selection scope: 선택 구간 anchor
   * - document scope: 전체 문서 스냅샷
   */
  applyAnchor: null | {
    scope: 'selection' | 'document';
    /** selection scope일 때 Monaco decoration ID */
    decorationId?: string;
    /** 요청 시점의 선택 텍스트 (검증용) */
    selectionText?: string;
    /** 요청 시점의 before/after 문맥 (폴백 매칭용) */
    beforeText?: string;
    afterText?: string;
    /** document scope일 때 요청 시점의 전체 문서 스냅샷 */
    baseDocument?: string;
    /** document scope일 때 요청 시점의 문서 해시 (변경 감지용) */
    baseDocumentHash?: string;
  };
}

interface ProjectActions {
  // 프로젝트 관리
  initializeProject: () => Promise<void>;
  loadProject: (
    project: ITEProject,
    options?: { hydrateComments?: boolean; hydrateChat?: boolean },
  ) => void;
  createNewProject: (metadata: Partial<ProjectMetadata>) => Promise<void>;
  saveProject: () => Promise<void>;
  switchProjectById: (projectId: string) => Promise<void>;
  updateGlossaryPaths: (paths: string[]) => void;
  addGlossaryPath: (path: string) => void;
  removeGlossaryPath: (path: string) => void;
  startAutoSave: () => void;
  stopAutoSave: () => void;

  // Target 단일 문서
  setTargetDocument: (next: string) => void;
  setSourceDocument: (next: string) => void;
  setTargetDocJson: (json: TipTapDocJson | null) => void;
  setSourceDocJson: (json: TipTapDocJson | null) => void;
  materializeBlocksForSnapshot: () => Record<string, EditorBlock> | null;
  setSourceLanguage: (lang: string) => void;
  setTargetLanguage: (lang: string) => void;
  rebuildTargetDocument: () => void;
  rebuildSourceDocument: () => void;

  finalizeEditSession: (params: { sessionId: string; status: EditSession['status'] }) => void;

  // Apply Anchor (요청 시점에 위치 추적)
  createApplyAnchor: (params: {
    scope: 'selection' | 'document';
    startOffset?: number;
    endOffset?: number;
    selectionText?: string;
    beforeText?: string;
    afterText?: string;
  }) => void;
  resolveApplyAnchor: () => {
    success: boolean;
    startOffset?: number;
    endOffset?: number;
    reason?: string;
  };
  clearApplyAnchor: () => void;

  // Target 문서 ↔ blocks 저장 브릿지
  registerTargetDocHandle: (handle: ProjectState['targetDocHandle']) => void;

  // 블록 관리
  getBlock: (blockId: string) => EditorBlock | undefined;
  getBlocksBySegment: (segmentGroupId: string, type: BlockType) => EditorBlock[];
  updateBlock: (blockId: string, content: string) => void;
  splitBlock: (blockId: string, splitPosition: number) => void;
  mergeBlocks: (blockIds: string[]) => void;
  mergeWithPreviousTargetBlock: (blockId: string) => void;

  // Apply & Diff
  applySuggestionToBlock: (blockId: string, suggestedText: string, selectionText?: string) => void;
  hasPendingDiff: (blockId: string) => boolean;
  acceptDiff: (blockId: string) => void;
  rejectDiff: (blockId: string) => void;

  // 세그먼트 관리
  getSegment: (segmentGroupId: string) => SegmentGroup | undefined;
  addSegment: (sourceContent: string, targetContent: string) => void;

  // 유틸리티
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;
}

type ProjectStore = ProjectState & ProjectActions;

const WRITE_THROUGH_DELAY_MS = 500;
const MAX_EDIT_SESSIONS = 50;
let writeThroughTimer: number | null = null;

let autoSaveTimer: number | null = null;
let autoSaveInFlight = false;
let saveInFlight: Promise<void> | null = null;
let saveQueued = false;
let hydrateCommentsRequestSeq = 0;
// L5: 프로젝트 전환 세대 토큰 — 연속 전환 시 마지막 요청만 반영(last-click-wins)
let switchProjectSeq = 0;

// ─── 에디터 debounce 동기화 flush 훅 (P1) ────────────────────────────────────
// TipTapEditor의 onChange/onJsonChange는 타이핑 성능을 위해 디바운스된다.
// 저장/스냅샷/프로젝트 전환은 최신 문서가 필요하므로, 등록된 flush를 먼저 실행해
// pending 편집을 store에 반영한다.

type EditorSyncFlush = () => void;
const editorSyncFlushes = new Set<EditorSyncFlush>();

/** TipTapEditor가 마운트 시 자신의 flush 함수를 등록한다. 반환값은 해제 함수. */
export function registerEditorSyncFlush(flush: EditorSyncFlush): () => void {
  editorSyncFlushes.add(flush);
  return () => {
    editorSyncFlushes.delete(flush);
  };
}

/** 등록된 모든 에디터의 pending onChange/onJsonChange를 즉시 store에 반영한다. */
export function flushPendingEditorSyncs(): void {
  for (const flush of Array.from(editorSyncFlushes)) {
    try {
      flush();
    } catch {
      // flush 실패가 저장/전환을 막지 않도록 무시
    }
  }
}

// 문서 동기화 세대(epoch): 프로젝트가 교체될 때마다 증가한다.
// 이전 프로젝트에서 스케줄된 디바운스 flush가 늦게 도착해 새 프로젝트 문서를
// 덮어쓰지 않도록, TipTapEditor는 스케줄 시점의 epoch와 발화 시점의 epoch를 비교한다.
let docSyncEpoch = 0;

export function getDocSyncEpoch(): number {
  return docSyncEpoch;
}

function bumpDocSyncEpoch(): void {
  docSyncEpoch++;
}

/**
 * 두 에디터의 현재 문서에서 살아있는 commentId 집합을 수집.
 * 마킹된 텍스트가 삭제되면 해당 마크도 사라지므로, 여기에 없는 commentId는 고아.
 */
function collectLiveCommentIds(): Set<string> {
  const ids = new Set<string>();
  const { sourceEditor, targetEditor } = useEditorStore.getState();
  for (const editor of [sourceEditor, targetEditor]) {
    if (!editor) continue;
    try {
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks) {
          if (mark.type.name === 'comment') {
            const id = mark.attrs?.commentId;
            if (typeof id === 'string' && id) ids.add(id);
          }
        }
        return true;
      });
    } catch {
      // ignore: 에디터 상태 접근 실패 시 해당 에디터는 건너뜀
    }
  }
  return ids;
}

/**
 * 현재 commentStore의 코멘트를 프로젝트별 영속 저장.
 * 저장 전에 고아 코멘트(마크가 사라진 commentId)를 정리한다.
 * 프로젝트 저장 완료 상태가 코멘트 테이블과 갈라지지 않도록 호출부에서 await 한다.
 */
async function persistCommentsForProject(projectId: string): Promise<void> {
  if (useProjectStore.getState().project?.id !== projectId) return;

  // 고아 정리: 에디터가 마운트된 경우에만(빈 집합으로 전부 지우는 사고 방지)
  const { sourceEditor, targetEditor } = useEditorStore.getState();
  if (sourceEditor || targetEditor) {
    useCommentStore.getState().pruneOrphans(collectLiveCommentIds());
  }

  if (useProjectStore.getState().project?.id !== projectId) return;
  const commentsToSave = useCommentStore.getState().comments;
  await saveComments(projectId, commentsToSave);
}

/**
 * 프로젝트별 코멘트를 로드해 commentStore에 하이드레이션.
 */
async function hydrateCommentsForProject(projectId: string): Promise<void> {
  const requestSeq = ++hydrateCommentsRequestSeq;
  useCommentStore.getState().clear();

  try {
    const comments = await loadComments(projectId);
    if (requestSeq !== hydrateCommentsRequestSeq) return;
    if (useProjectStore.getState().project?.id !== projectId) return;
    useCommentStore.getState().setComments(comments);
  } catch (e) {
    if (requestSeq !== hydrateCommentsRequestSeq) return;
    if (useProjectStore.getState().project?.id !== projectId) return;
    console.error('[hydrateComments] FAILED:', e instanceof Error ? e.message : e);
    // 로드 실패 시 이전 프로젝트 코멘트가 남지 않도록 비움
    useCommentStore.getState().clear();
  }
}

function clearCommentsForProjectContext(): void {
  hydrateCommentsRequestSeq++;
  useCommentStore.getState().clear();
}

// ============================================
// Initial State
// ============================================

const createInitialProject = (): ITEProject => {
  const now = Date.now();
  const projectId = uuidv4();

  // 샘플 블록 생성
  const sourceBlock1Id = uuidv4();
  const targetBlock1Id = uuidv4();
  const sourceBlock2Id = uuidv4();
  const targetBlock2Id = uuidv4();

  const blocks: Record<string, EditorBlock> = {
    [sourceBlock1Id]: {
      id: sourceBlock1Id,
      type: 'source',
      content: '<p>Hello, welcome to OddEyes.ai.</p>',
      hash: hashContent('Hello, welcome to OddEyes.ai.'),
      metadata: {
        createdAt: now,
        updatedAt: now,
        tags: [],
      },
    },
    [targetBlock1Id]: {
      id: targetBlock1Id,
      type: 'target',
      content: '<p>안녕하세요, 통합 번역 에디터에 오신 것을 환영합니다.</p>',
      hash: hashContent('안녕하세요, 통합 번역 에디터에 오신 것을 환영합니다.'),
      metadata: {
        createdAt: now,
        updatedAt: now,
        tags: [],
      },
    },
    [sourceBlock2Id]: {
      id: sourceBlock2Id,
      type: 'source',
      content: '<p>This editor supports N:M mapping between source and target blocks.</p>',
      hash: hashContent('This editor supports N:M mapping between source and target blocks.'),
      metadata: {
        createdAt: now,
        updatedAt: now,
        tags: [],
      },
    },
    [targetBlock2Id]: {
      id: targetBlock2Id,
      type: 'target',
      content: '<p>이 에디터는 원문과 번역문 블록 간 N:M 매핑을 지원합니다.</p>',
      hash: hashContent('이 에디터는 원문과 번역문 블록 간 N:M 매핑을 지원합니다.'),
      metadata: {
        createdAt: now,
        updatedAt: now,
        tags: [],
      },
    },
  };

  const segments: SegmentGroup[] = [
    {
      groupId: uuidv4(),
      sourceIds: [sourceBlock1Id],
      targetIds: [targetBlock1Id],
      isAligned: true,
      order: 0,
    },
    {
      groupId: uuidv4(),
      sourceIds: [sourceBlock2Id],
      targetIds: [targetBlock2Id],
      isAligned: true,
      order: 1,
    },
  ];

  return {
    id: projectId,
    version: '1.0.0',
    metadata: {
      title: 'New Project',
      description: '',
      domain: 'general',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30000,
        theme: 'system',
      },
    },
    segments,
    blocks,
  };
};

// ============================================
// Store Implementation
// ============================================

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      // Initial State
      project: null,
      isDirty: false,
      isLoading: false,
      error: null,
      lastProjectId: null,
      lastChangeAt: 0,
      lastSavedAt: 0,
      saveStatus: 'idle',
      lastSaveError: null,
      pendingDiffs: {},
      targetDocument: '',
      sourceDocument: '',
      sourceDocJson: null,
      targetDocJson: null,
      targetDocHandle: null,
      editSessions: [],
      applyAnchor: null,

      // 프로젝트 초기화
      initializeProject: async (): Promise<void> => {
        bumpDocSyncEpoch();
        set({ isLoading: true, error: null });
        try {
          const { lastProjectId } = get();

          if (lastProjectId) {
            try {
              const loaded = await tauriLoadProject(lastProjectId);
              const td = buildTargetDocument(loaded);
              const sd = buildSourceDocument(loaded);
              set({
                project: loaded,
                isDirty: false,
                isLoading: false,
                error: null,
                targetDocument: td.text,
                sourceDocument: sd.text,
                // AI 도구용 TipTap JSON 초기화 (에디터 마운트 전에도 접근 가능)
                sourceDocJson: htmlToTipTapJson(sd.text),
                targetDocJson: htmlToTipTapJson(td.text),
              });
              // chatStore 하이드레이션 (프로젝트별 설정 로드)
              await useChatStore.getState().hydrateForProject(loaded.id);
              await hydrateCommentsForProject(loaded.id);
              return;
            } catch (err) {
              console.warn('[initializeProject] Failed to load lastProjectId:', lastProjectId, err instanceof Error ? err.message : err);
            }
          }

          // lastProjectId가 없거나 로드 실패한 경우: DB에 저장된 최근 프로젝트를 우선 로드
          try {
            const ids = await tauriListProjectIds();
            const first = ids[0];
            if (first) {
              const loaded = await tauriLoadProject(first);
              const td = buildTargetDocument(loaded);
              const sd = buildSourceDocument(loaded);
              set({
                project: loaded,
                isDirty: false,
                isLoading: false,
                error: null,
                lastProjectId: loaded.id,
                targetDocument: td.text,
                sourceDocument: sd.text,
                // AI 도구용 TipTap JSON 초기화 (에디터 마운트 전에도 접근 가능)
                sourceDocJson: htmlToTipTapJson(sd.text),
                targetDocJson: htmlToTipTapJson(td.text),
              });
              // chatStore 하이드레이션 (프로젝트별 설정 로드)
              await useChatStore.getState().hydrateForProject(loaded.id);
              await hydrateCommentsForProject(loaded.id);
              return;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load project';
            console.warn('[initializeProject] DB fallback failed:', message);
            set({ error: message, isLoading: false });
          }

          // 프로젝트가 하나도 없는 경우: null 유지 (Blank Page UX를 위함)
          set({
            project: null,
            isLoading: false,
            lastProjectId: null,
            sourceDocJson: null,
            targetDocJson: null,
          });
          // chatStore 초기화 (프로젝트 없음)
          await useChatStore.getState().hydrateForProject(null);
          clearCommentsForProjectContext();
        } catch (err) {
          console.error('[initializeProject] Unhandled error:', err);
          set({ error: err instanceof Error ? err.message : 'Initialization failed', isLoading: false });
        }
      },

      startAutoSave: (): void => {
        if (autoSaveTimer !== null) return;

        const tick = (): void => {
          const { project, isDirty, isLoading, lastChangeAt } = get();
          const settings = project?.metadata.settings;
          const enabled = settings?.autoSave === true;
          const debounceMs = 1500;
          const idleFor = Date.now() - (lastChangeAt || 0);
          const canSaveNow = lastChangeAt > 0 && idleFor >= debounceMs;

          if (enabled && isDirty && canSaveNow && !isLoading && !autoSaveInFlight) {
            autoSaveInFlight = true;
            void get()
              .saveProject()
              .catch((err: unknown) => {
                // autosave 실패 시 콘솔에 로그 + 상태 업데이트 (UI는 방해하지 않음)
                // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
                const message = err instanceof Error ? err.message : String(err);
                console.warn('[AutoSave] Failed:', message);
                set({
                  saveStatus: 'error',
                  lastSaveError: err instanceof Error ? err.message : 'AutoSave failed',
                });
              })
              .finally(() => {
                autoSaveInFlight = false;
              });
          }

          // interval(예: 30s)은 “체크 주기”로 쓰면 저장 반영이 늦게 느껴질 수 있어서,
          // tick은 짧게 돌리고(500ms), 실제 저장은 debounceMs로 제어합니다.
          autoSaveTimer = window.setTimeout(tick, 500);
        };

        autoSaveTimer = window.setTimeout(tick, 500);
      },

      stopAutoSave: (): void => {
        if (autoSaveTimer !== null) {
          window.clearTimeout(autoSaveTimer);
          autoSaveTimer = null;
        }
        // writeThroughTimer도 함께 정리 (dangling closure 방지)
        if (writeThroughTimer !== null) {
          window.clearTimeout(writeThroughTimer);
          writeThroughTimer = null;
        }
        autoSaveInFlight = false;
      },

      updateGlossaryPaths: (paths: string[]): void => {
        const { project } = get();
        if (!project) return;
        const deduped = Array.from(new Set(paths.filter((p) => p.trim().length > 0)));
        set({
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              glossaryPaths: deduped,
              updatedAt: Date.now(),
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      addGlossaryPath: (path: string): void => {
        const p = path.trim();
        if (!p) return;
        const { project } = get();
        if (!project) return;
        const prev = project.metadata.glossaryPaths ?? [];
        const next = Array.from(new Set([...prev, p]));
        set({
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              glossaryPaths: next,
              updatedAt: Date.now(),
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      removeGlossaryPath: (path: string): void => {
        const { project } = get();
        if (!project) return;
        const prev = project.metadata.glossaryPaths ?? [];
        const next = prev.filter((p) => p !== path);
        set({
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              glossaryPaths: next,
              updatedAt: Date.now(),
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      // 프로젝트 로드
      // 주의: 이전 프로젝트가 dirty면 저장하지 않고 바로 덮어씁니다.
      // 이전 프로젝트를 저장하려면 호출 전에 saveProject()를 먼저 호출하거나,
      // switchProjectById()를 사용하세요.
      loadProject: (
        project: ITEProject,
        options?: { hydrateComments?: boolean; hydrateChat?: boolean },
      ): void => {
        // P1: 프로젝트 교체 세대 증가 — 이전 프로젝트에서 스케줄된 에디터 디바운스 flush가
        // 늦게 발화해 새 프로젝트 문서를 덮어쓰는 것을 방지
        bumpDocSyncEpoch();
        // write-through 타이머 취소 (이전 프로젝트가 새 프로젝트 상태로 저장되는 것 방지)
        if (writeThroughTimer !== null) {
          window.clearTimeout(writeThroughTimer);
          writeThroughTimer = null;
        }
        // L3: 이전 프로젝트 기준의 Desktop 번역 프리뷰가 새 프로젝트 위에 남지 않도록 정리
        useTranslationPreviewStore.getState().clearPreview();

        const td = buildTargetDocument(project);
        const sd = buildSourceDocument(project);
        set({
          project,
          isDirty: false,
          isLoading: false,
          error: null,
          lastProjectId: project.id,
          targetDocument: td.text,
          sourceDocument: sd.text,
          // AI 도구용 TipTap JSON 초기화 (에디터 마운트 전에도 접근 가능)
          sourceDocJson: htmlToTipTapJson(sd.text),
          targetDocJson: htmlToTipTapJson(td.text),
          // pendingDiffs 초기화 (이전 프로젝트의 diff가 남아있으면 문제)
          pendingDiffs: {},
          editSessions: [],
        });
        if (options?.hydrateChat !== false) {
          void useChatStore.getState().hydrateForProject(project.id);
        }
        if (options?.hydrateComments === false) {
          hydrateCommentsRequestSeq++;
        } else {
          void hydrateCommentsForProject(project.id);
        }
      },

      // 새 프로젝트 생성
      createNewProject: async (metadata: Partial<ProjectMetadata>): Promise<void> => {
        const { project, isDirty, stopAutoSave, startAutoSave } = get();

        // 기존 프로젝트가 있고 변경사항이 있으면 먼저 저장
        if (project && isDirty) {
          stopAutoSave();
          try {
            await get().saveProject();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn('[createNewProject] Failed to save previous project:', message);
            throw e;
          } finally {
            startAutoSave();
          }
        }
        createAndSetNewProject();

        function createAndSetNewProject(): void {
          bumpDocSyncEpoch();
          // L3: 이전 프로젝트 기준의 Desktop 번역 프리뷰 정리
          useTranslationPreviewStore.getState().clearPreview();
          const initialProject = createInitialProject();
          const nextProject: ITEProject = {
            ...initialProject,
            metadata: {
              ...initialProject.metadata,
              ...metadata,
            },
          };
          const td = buildTargetDocument(nextProject);
          const sd = buildSourceDocument(nextProject);
          set({
            project: nextProject,
            isDirty: true,
            lastChangeAt: Date.now(),
            lastProjectId: initialProject.id,
            targetDocument: td.text,
            sourceDocument: sd.text,
            // AI 도구용 TipTap JSON 초기화 (에디터 마운트 전에도 접근 가능)
            sourceDocJson: htmlToTipTapJson(sd.text),
            targetDocJson: htmlToTipTapJson(td.text),
          });
          clearCommentsForProjectContext();
          scheduleWriteThroughSave(set, get);
        }
      },

      // 프로젝트 저장 (Tauri 백엔드 호출 예정)
      saveProject: async (): Promise<void> => {
        if (saveInFlight) {
          saveQueued = true;
          return saveInFlight;
        }

        const saveOnce = async (): Promise<void> => {
          // P1: 디바운스로 아직 store에 반영되지 않은 에디터 편집을 스냅샷 전에 flush
          flushPendingEditorSyncs();
          const snapshot = get();
          const { project, targetDocument, sourceDocument, targetDocHandle } = snapshot;

          console.warn('[saveProject] called, projectId:', project?.id);

          if (!project) {
            console.warn('[saveProject] No project, returning');
            return;
          }

          set({ isLoading: true, saveStatus: 'saving', lastSaveError: null });

          try {
            const now = Date.now();
            const nextBlocks = materializeBlocksFromDocuments({
              project,
              targetDocument,
              sourceDocument,
              targetDocHandle,
              now,
            });

            const projectToSave: ITEProject = {
              ...project,
              blocks: nextBlocks,
              metadata: {
                ...project.metadata,
                updatedAt: now,
              },
            };

            console.warn('[saveProject] saving, blocks:', Object.keys(nextBlocks).length);

            await tauriSaveProject(projectToSave);
            await persistCommentsForProject(projectToSave.id);

            const current = get();
            if (current.project?.id !== projectToSave.id) {
              set({ isLoading: false, saveStatus: 'idle' });
              return;
            }

            const changedDuringSave =
              current.project !== project ||
              current.targetDocument !== targetDocument ||
              current.sourceDocument !== sourceDocument ||
              current.targetDocHandle !== targetDocHandle;

            if (changedDuringSave) {
              saveQueued = true;
              return;
            }

            console.warn('[saveProject] success:', projectToSave.id);

            set({
              project: projectToSave,
              isDirty: false,
              isLoading: false,
              saveStatus: 'idle',
              lastSavedAt: Date.now(),
              lastProjectId: projectToSave.id,
            });
          } catch (error) {
            // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
            const errorMessage = error instanceof Error ? error.message : 'Failed to save project';
            const normalizedError = error instanceof Error ? error : new Error(errorMessage);
            console.error('[saveProject] FAILED:', errorMessage);
            set({
              error: errorMessage,
              isLoading: false,
              saveStatus: 'error',
              lastSaveError: errorMessage,
            });
            throw normalizedError;
          }
        };

        saveQueued = false;
        saveInFlight = (async (): Promise<void> => {
          try {
            do {
              saveQueued = false;
              await saveOnce();
            } while (saveQueued);
          } finally {
            saveQueued = false;
            saveInFlight = null;
          }
        })();

        return saveInFlight;
      },

      materializeBlocksForSnapshot: (): Record<string, EditorBlock> | null => {
        // P1: 스냅샷 호출부(번역/폴리싱 적용 직후, 히스토리 자동 스냅샷 등)가 디바운스로
        // 뒤처진 문서를 캡처하지 않도록 pending 에디터 동기화를 먼저 flush한다.
        flushPendingEditorSyncs();
        const { project, targetDocument, sourceDocument, targetDocHandle } = get();
        if (!project) return null;
        // now=0 고정: snapshot hash 비교용이므로 timestamp가 달라지면 안 됨
        return materializeBlocksFromDocuments({
          project,
          targetDocument,
          sourceDocument,
          targetDocHandle,
          now: 0,
        });
      },

      // 프로젝트 전환(auto-save-and-switch)
      switchProjectById: async (projectId: string): Promise<void> => {
        const { project, stopAutoSave, startAutoSave, saveProject, loadProject } = get();
        if (!projectId) return;
        if (project?.id === projectId) return;

        // L5: 전환 세대 토큰 — 전환이 겹치면(연속 클릭) 마지막 요청만 반영한다.
        // stale 전환은 await 재개 시점에 조용히 중단해 last-click-wins를 보장한다.
        const seq = ++switchProjectSeq;
        const isStaleSwitch = (): boolean => seq !== switchProjectSeq;

        stopAutoSave();
        // P1/L5: 디바운스로 아직 store에 반영되지 않은 에디터 편집을 먼저 flush해
        // 아래 isDirty 판정과 저장에서 마지막 편집분이 유실되지 않게 한다.
        flushPendingEditorSyncs();
        // 에디터 상태 정리 (이전 프로젝트의 에디터 참조 제거)
        useEditorStore.getState().clearEditors();
        // L3: 이전 프로젝트 기준의 Desktop 번역 프리뷰 정리 (loadProject에서도 정리하지만,
        // 비동기 전환 중 stale 프리뷰가 apply되지 않도록 시작 시점에 즉시 정리)
        useTranslationPreviewStore.getState().clearPreview();
        // 이전 프로젝트의 히스토리 상태 정리. 반드시 loadProject로 새 projectId가 반영되기
        // "전"에 수행해야 한다 — reset이 loadHistoryRequestSeq를 올리므로, 새 projectId를 보고
        // 뜬 App의 loadHistory보다 늦게 실행되면 그 로드가 무효화되어 latestBlocksHash가
        // null로 남고 auto snapshot이 계속 조기 반환한다.
        // (historyStore가 projectStore를 import하므로 순환을 피하려 동적 import를 쓴다)
        const { useHistoryStore } = await import('@/stores/historyStore');
        useHistoryStore.getState().reset();
        set({ isLoading: true, error: null });

        try {
          if (get().isDirty) {
            await saveProject();
          }
          if (isStaleSwitch()) return;

          const loaded = await tauriLoadProject(projectId);
          if (isStaleSwitch()) return;
          // switchProjectById는 아래에서 두 하이드레이션을 await하므로
          // loadProject의 기본 fire-and-forget 호출은 생략한다.
          loadProject(loaded, { hydrateChat: false, hydrateComments: false });

          // Issue #3 수정: chatStore 하이드레이션을 프로젝트 전환 시 명시적으로 호출
          // React useEffect 의존 대신 직접 호출하여 race condition 방지
          // (hydrateForProject/hydrateCommentsForProject는 내부에 자체 세대 가드가 있어,
          //  loadProject 반영 이후의 늦은 완료가 새 전환 상태를 덮지 않는다)
          await useChatStore.getState().hydrateForProject(loaded.id);
          await hydrateCommentsForProject(loaded.id);
        } catch (e) {
          // stale 전환의 에러가 최신 전환의 상태를 덮지 않도록 무시
          if (isStaleSwitch()) return;
          const switchError = e instanceof Error ? e : new Error('Failed to switch project');
          set({
            error: switchError.message,
            isLoading: false,
          });
          throw switchError;
        } finally {
          // 최신 전환만 정리를 수행 (stale 전환의 finally가 진행 중인 전환을 방해하지 않도록)
          if (!isStaleSwitch()) {
            startAutoSave();
          }
        }
      },

      setTargetDocument: (next: string): void => {
        if (get().targetDocument === next) return;
        set({ targetDocument: next, isDirty: true, lastChangeAt: Date.now() });
        scheduleWriteThroughSave(set, get);
      },

      setSourceDocument: (next: string): void => {
        if (get().sourceDocument === next) return;
        set({ sourceDocument: next, isDirty: true, lastChangeAt: Date.now() });
        scheduleWriteThroughSave(set, get);
      },

      setTargetDocJson: (json: TipTapDocJson | null): void => {
        set({ targetDocJson: json });
      },

      setSourceDocJson: (json: TipTapDocJson | null): void => {
        set({ sourceDocJson: json });
      },

      setSourceLanguage: (lang: string): void => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              sourceLanguage: lang,
              updatedAt: Date.now(),
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      setTargetLanguage: (lang: string): void => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              targetLanguage: lang,
              updatedAt: Date.now(),
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      rebuildTargetDocument: (): void => {
        const { project } = get();
        if (!project) return;
        const td = buildTargetDocument(project);
        set({ targetDocument: td.text });
      },

      rebuildSourceDocument: (): void => {
        const { project } = get();
        if (!project) return;
        const sd = buildSourceDocument(project);
        set({ sourceDocument: sd.text });
      },

      // NOTE: Monaco 시대의 pendingDocDiff/openDocDiffPreview/acceptDocDiff/rejectDocDiff는
      // 전역 참조가 없어 제거됨 (코드리뷰 2026-07-07 §L5). editSessions/applyAnchor/
      // targetDocHandle도 외부 참조가 없는 잔재이나, 이번 정리 범위 밖이라 유지.
      finalizeEditSession: ({ sessionId, status }): void => {
        const { editSessions } = get();
        const idx = editSessions.findIndex((s) => s.id === sessionId);
        if (idx < 0) return;
        const cur = editSessions[idx];
        if (!cur || cur.status !== 'pending') return;
        const next = { ...cur, status };
        let updated = [...editSessions];
        updated[idx] = next;
        // Evict old finalized sessions if over limit
        if (updated.length > MAX_EDIT_SESSIONS) {
          updated = [
            ...updated.filter((s) => s.status === 'pending'),
            ...updated.filter((s) => s.status !== 'pending').slice(-MAX_EDIT_SESSIONS),
          ];
        }
        set({ editSessions: updated });
      },

      // Apply Anchor: 요청 시점에 위치/문서 상태를 캡처
      createApplyAnchor: (params): void => {
        const { targetDocHandle, targetDocument } = get();

        if (params.scope === 'selection') {
          // Selection scope: Monaco decoration으로 위치 추적
          let decorationId: string | undefined;
          if (
            typeof params.startOffset === 'number' &&
            typeof params.endOffset === 'number' &&
            targetDocHandle?.createAnchorDecoration
          ) {
            decorationId =
              targetDocHandle.createAnchorDecoration(params.startOffset, params.endOffset) ??
              undefined;
          }

          set({
            applyAnchor: {
              scope: 'selection',
              ...(decorationId ? { decorationId } : {}),
              ...(params.selectionText ? { selectionText: params.selectionText } : {}),
              ...(params.beforeText ? { beforeText: params.beforeText } : {}),
              ...(params.afterText ? { afterText: params.afterText } : {}),
            },
          });
        } else {
          // Document scope: 전체 문서 스냅샷 저장
          set({
            applyAnchor: {
              scope: 'document',
              baseDocument: targetDocument,
              baseDocumentHash: hashContent(targetDocument),
            },
          });
        }
      },

      // Apply Anchor: 응답 완료 시 최신 offset 해석 + 검증
      resolveApplyAnchor: (): {
        success: boolean;
        startOffset?: number;
        endOffset?: number;
        reason?: string;
      } => {
        const { applyAnchor, targetDocHandle, targetDocument } = get();
        if (!applyAnchor) {
          return { success: false, reason: 'No apply anchor exists' };
        }

        if (applyAnchor.scope === 'document') {
          // Document scope: 문서가 변경되었는지 체크
          const currentHash = hashContent(targetDocument);
          if (applyAnchor.baseDocumentHash && applyAnchor.baseDocumentHash !== currentHash) {
            return {
              success: false,
              reason: '문서가 변경되어 적용할 수 없습니다. 다시 요청해주세요.',
            };
          }
          // 전체 문서 범위
          return {
            success: true,
            startOffset: 0,
            endOffset: targetDocument.length,
          };
        }

        // Selection scope: decoration에서 최신 offset 가져오기
        if (applyAnchor.decorationId && targetDocHandle?.getDecorationOffsets) {
          const resolved = targetDocHandle.getDecorationOffsets(applyAnchor.decorationId);
          if (resolved) {
            // 검증: 해당 위치의 텍스트가 원래 선택과 일치하는지
            const currentText = targetDocument.slice(resolved.startOffset, resolved.endOffset);
            if (applyAnchor.selectionText && currentText !== applyAnchor.selectionText) {
              // 불일치 - 텍스트 매칭으로 폴백 시도
              const fallbackIdx = targetDocument.indexOf(applyAnchor.selectionText);
              if (fallbackIdx >= 0) {
                return {
                  success: true,
                  startOffset: fallbackIdx,
                  endOffset: fallbackIdx + applyAnchor.selectionText.length,
                };
              }
              return {
                success: false,
                reason: '선택 구간이 변경되어 적용할 수 없습니다. 다시 선택해주세요.',
              };
            }
            return {
              success: true,
              startOffset: resolved.startOffset,
              endOffset: resolved.endOffset,
            };
          }
        }

        // Decoration이 없거나 해석 실패 - 텍스트 매칭으로 폴백
        if (applyAnchor.selectionText) {
          const fallbackIdx = targetDocument.indexOf(applyAnchor.selectionText);
          if (fallbackIdx >= 0) {
            return {
              success: true,
              startOffset: fallbackIdx,
              endOffset: fallbackIdx + applyAnchor.selectionText.length,
            };
          }
        }

        return {
          success: false,
          reason: '적용할 위치를 찾을 수 없습니다. 다시 선택해주세요.',
        };
      },

      // Apply Anchor: 정리
      clearApplyAnchor: (): void => {
        const { applyAnchor, targetDocHandle } = get();
        if (applyAnchor?.decorationId && targetDocHandle?.removeDecoration) {
          targetDocHandle.removeDecoration(applyAnchor.decorationId);
        }
        set({ applyAnchor: null });
      },

      registerTargetDocHandle: (handle): void => {
        set({ targetDocHandle: handle });
      },

      // 블록 조회
      getBlock: (blockId: string): EditorBlock | undefined => {
        const { project } = get();
        return project?.blocks[blockId];
      },

      // 세그먼트별 블록 조회
      getBlocksBySegment: (segmentGroupId: string, type: BlockType): EditorBlock[] => {
        const { project } = get();
        if (!project) return [];

        const segment = project.segments.find((s) => s.groupId === segmentGroupId);
        if (!segment) return [];

        const blockIds = type === 'source' ? segment.sourceIds : segment.targetIds;
        return blockIds
          .map((id) => project.blocks[id])
          .filter((block): block is EditorBlock => block !== undefined);
      },

      // 블록 업데이트
      updateBlock: (blockId: string, content: string): void => {
        const { project } = get();
        if (!project) return;

        const block = project.blocks[blockId];
        if (!block) return;

        const newHash = hashContent(content);
        if (block.hash === newHash) return; // 변경 없음

        set({
          project: {
            ...project,
            blocks: {
              ...project.blocks,
              [blockId]: {
                ...block,
                content,
                hash: newHash,
                metadata: {
                  ...block.metadata,
                  updatedAt: Date.now(),
                },
              },
            },
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      // 블록 분할
      splitBlock: (blockId: string, splitPosition: number): void => {
        const { project } = get();
        if (!project) return;

        const block = project.blocks[blockId];
        if (!block || block.type !== 'target') return;

        // 현재 블록이 속한 세그먼트 찾기
        const segment = project.segments.find((s) => s.targetIds.includes(blockId));
        if (!segment) return;

        const now = Date.now();

        // HTML 기반 콘텐츠를 "텍스트" 기준으로 분할 (프로토타입)
        // TipTap의 문서 포지션을 완벽하게 HTML로 매핑하는 대신,
        // plain text로 변환 후 offset 위치로 분할하고 <p>로 감쌉니다.
        const plain = stripHtml(block.content);
        const safePos = Math.max(0, Math.min(splitPosition, plain.length));
        const firstText = plain.slice(0, safePos);
        const secondText = plain.slice(safePos);
        const firstPart = toParagraphHtml(firstText);
        const secondPart = toParagraphHtml(secondText);

        // 새 블록 생성
        const newBlockId = uuidv4();
        const newBlock: EditorBlock = {
          id: newBlockId,
          type: 'target',
          content: secondPart,
          hash: hashContent(secondPart),
          metadata: {
            createdAt: now,
            updatedAt: now,
            tags: [],
          },
        };

        // 기존 블록 업데이트
        const updatedBlock: EditorBlock = {
          ...block,
          content: firstPart,
          hash: hashContent(firstPart),
          metadata: {
            ...block.metadata,
            updatedAt: now,
          },
        };

        // 세그먼트 업데이트
        const blockIndex = segment.targetIds.indexOf(blockId);
        const newTargetIds = [...segment.targetIds];
        newTargetIds.splice(blockIndex + 1, 0, newBlockId);

        const updatedSegment: SegmentGroup = {
          ...segment,
          targetIds: newTargetIds,
          isAligned: false,
        };

        set({
          project: {
            ...project,
            blocks: {
              ...project.blocks,
              [blockId]: updatedBlock,
              [newBlockId]: newBlock,
            },
            segments: project.segments.map((s) =>
              s.groupId === segment.groupId ? updatedSegment : s
            ),
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      // 블록 병합
      mergeBlocks: (blockIds: string[]): void => {
        const { project } = get();
        if (!project || blockIds.length < 2) return;

        // 같은 세그먼트에 속하는지 확인
        const segment = project.segments.find((s) =>
          blockIds.every((id) => s.targetIds.includes(id))
        );
        if (!segment) return;

        const now = Date.now();

        // 블록 내용 병합
        const mergedContent = blockIds
          .map((id) => project.blocks[id]?.content ?? '')
          .join('');

        const firstBlockId = blockIds[0];
        if (!firstBlockId) return;

        const firstBlock = project.blocks[firstBlockId];
        if (!firstBlock) return;

        // 첫 번째 블록 업데이트
        const updatedBlock: EditorBlock = {
          ...firstBlock,
          content: mergedContent,
          hash: hashContent(mergedContent),
          metadata: {
            ...firstBlock.metadata,
            updatedAt: now,
          },
        };

        // 나머지 블록 ID 제거
        const remainingBlockIds = blockIds.slice(1);
        const newBlocks = { ...project.blocks };
        remainingBlockIds.forEach((id) => {
          delete newBlocks[id];
        });
        newBlocks[firstBlockId] = updatedBlock;

        // 세그먼트에서 병합된 블록 ID 제거
        const newTargetIds = segment.targetIds.filter(
          (id) => !remainingBlockIds.includes(id)
        );

        set({
          project: {
            ...project,
            blocks: newBlocks,
            segments: project.segments.map((s) =>
              s.groupId === segment.groupId
                ? { ...s, targetIds: newTargetIds }
                : s
            ),
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      // Apply: 제안 텍스트를 Diff 형태로 블록에 주입 (pending)
      applySuggestionToBlock: (blockId: string, suggestedText: string, selectionText?: string): void => {
        const { project, pendingDiffs } = get();
        if (!project) return;
        const block = project.blocks[blockId];
        if (!block || block.type !== 'target') return;

        const originalHtml = block.content;
        const originalPlain = stripHtml(originalHtml);
        const selection = selectionText?.trim();
        const replacedPlain = selection
          ? replaceFirst(originalPlain, selection, suggestedText.trim())
          : suggestedText.trim();

        const diff = createDiffResult(blockId, originalPlain, replacedPlain);

        const htmlBody = diffToHtml(diff.changes);
        const diffHtml = `<p>${htmlBody}</p>`;

        // NOTE: Apply 단계에서는 write-thru 저장을 하지 않습니다(프로토타입).
        // Accept에서 최종 텍스트로 확정될 때 저장됩니다.
        set({
          project: {
            ...project,
            blocks: {
              ...project.blocks,
              [blockId]: {
                ...block,
                content: diffHtml,
                // hash/updatedAt은 Accept에서 최종 확정 시점에 갱신
              },
            },
          },
          pendingDiffs: {
            ...pendingDiffs,
            [blockId]: { ...diff, originalHtml },
          },
        });
      },

      hasPendingDiff: (blockId: string): boolean => {
        const { pendingDiffs } = get();
        return pendingDiffs[blockId] !== undefined;
      },

      acceptDiff: (blockId: string): void => {
        const { pendingDiffs, project } = get();
        if (!project) return;
        const pending = pendingDiffs[blockId];
        if (!pending) return;

        const finalText = applyDiff(pending.changes);
        const finalHtml = toParagraphHtml(finalText);

        // 최종 확정은 updateBlock을 통해 hash/updatedAt 및 write-thru 저장까지 같이 수행
        const { [blockId]: _, ...restDiffs } = pendingDiffs;
        set({ pendingDiffs: restDiffs });
        get().updateBlock(blockId, finalHtml);
      },

      rejectDiff: (blockId: string): void => {
        const { pendingDiffs, project } = get();
        if (!project) return;
        const pending = pendingDiffs[blockId];
        if (!pending) return;

        // revert: 원본 HTML로 복원 (store에 저장해둔 originalHtml)
        const originalHtml = pending.originalHtml;
        const { [blockId]: _, ...restDiffs } = pendingDiffs;

        set({
          pendingDiffs: restDiffs,
          project: {
            ...project,
            blocks: {
              ...project.blocks,
              [blockId]: {
                ...project.blocks[blockId]!,
                content: originalHtml,
              },
            },
          },
        });
      },

      // Backspace(블록 시작)에서 이전 target 블록과 병합
      mergeWithPreviousTargetBlock: (blockId: string): void => {
        const { project } = get();
        if (!project) return;
        const block = project.blocks[blockId];
        if (!block || block.type !== 'target') return;

        const segment = project.segments.find((s) => s.targetIds.includes(blockId));
        if (!segment) return;

        const index = segment.targetIds.indexOf(blockId);
        if (index <= 0) return;

        const prevId = segment.targetIds[index - 1];
        if (!prevId) return;

        get().mergeBlocks([prevId, blockId]);
      },

      // 세그먼트 조회
      getSegment: (segmentGroupId: string): SegmentGroup | undefined => {
        const { project } = get();
        return project?.segments.find((s) => s.groupId === segmentGroupId);
      },

      // 세그먼트 추가
      addSegment: (sourceContent: string, targetContent: string): void => {
        const { project } = get();
        if (!project) return;

        const now = Date.now();
        const sourceBlockId = uuidv4();
        const targetBlockId = uuidv4();
        const segmentId = uuidv4();

        const sourceBlock: EditorBlock = {
          id: sourceBlockId,
          type: 'source',
          content: toParagraphHtml(sourceContent),
          hash: hashContent(sourceContent),
          metadata: {
            createdAt: now,
            updatedAt: now,
            tags: [],
          },
        };

        const targetBlock: EditorBlock = {
          id: targetBlockId,
          type: 'target',
          content: toParagraphHtml(targetContent),
          hash: hashContent(targetContent),
          metadata: {
            createdAt: now,
            updatedAt: now,
            tags: [],
          },
        };

        const newSegment: SegmentGroup = {
          groupId: segmentId,
          sourceIds: [sourceBlockId],
          targetIds: [targetBlockId],
          isAligned: true,
          order: project.segments.length,
        };

        set({
          project: {
            ...project,
            blocks: {
              ...project.blocks,
              [sourceBlockId]: sourceBlock,
              [targetBlockId]: targetBlock,
            },
            segments: [...project.segments, newSegment],
          },
          isDirty: true,
          lastChangeAt: Date.now(),
        });
        scheduleWriteThroughSave(set, get);
      },

      // 에러 설정
      setError: (error: string | null): void => {
        set({ error });
      },

      // 로딩 상태 설정
      setLoading: (isLoading: boolean): void => {
        set({ isLoading });
      },
    }),
    {
      name: 'ite-project-storage',
      partialize: (state) => ({
        lastProjectId: state.lastProjectId,
      }),
    },
  ),
);

function materializeBlocksFromDocuments(params: {
  project: ITEProject;
  targetDocument: string;
  sourceDocument: string;
  targetDocHandle: ProjectState['targetDocHandle'];
  now: number;
}): Record<string, EditorBlock> {
  const { project, targetDocument, sourceDocument, targetDocHandle, now } = params;
  const nextBlocks: Record<string, EditorBlock> = { ...project.blocks };

  const applyTargetByTrackedRanges = (): boolean => {
    // targetDocument가 비어있으면 기존 blocks 유지 (데이터 손실 방지)
    if (!targetDocument || targetDocument.length === 0) return false;
    if (!targetDocHandle) return false;
    const ranges = targetDocHandle.getBlockOffsets();
    const entries = Object.entries(ranges);
    if (entries.length === 0) return false;

    let touched = 0;
    for (const [blockId, r] of entries) {
      const block = nextBlocks[blockId];
      if (!block || block.type !== 'target') continue;
      const start = Math.max(0, Math.min(r.startOffset, targetDocument.length));
      const end = Math.max(start, Math.min(r.endOffset, targetDocument.length));
      const plain = targetDocument.slice(start, end);
      const html = toParagraphHtml(plain);
      nextBlocks[blockId] = {
        ...block,
        content: html,
        hash: hashContent(html),
        metadata: { ...block.metadata, updatedAt: now },
      };
      touched++;
    }
    return touched > 0;
  };

  const applyTargetFallback = (): void => {
    // targetDocument가 비어있거나 초기화되지 않았으면 blocks 역투영 스킵
    // (기존 blocks 내용 유지)
    if (!targetDocument || targetDocument.length === 0) {
      return;
    }

    // 원본 blocks 기준으로 초기 offset을 계산하고,
    // 현재 targetDocument 길이와의 차이를 마지막 블록에 적용합니다.
    // 이렇게 하면 사용자가 추가한 줄바꿈이 잘못된 세그먼트로 매핑되는 문제를 방지합니다.
    const initialBuild = buildTargetDocument(project);
    const initialLength = initialBuild.text.length;
    const currentLength = targetDocument.length;
    const delta = currentLength - initialLength;

    const blockIds = Object.keys(initialBuild.blockRanges);
    if (blockIds.length === 0) return; // 블록이 없으면 스킵

    const lastBlockId = blockIds[blockIds.length - 1];

    for (const [blockId, r] of Object.entries(initialBuild.blockRanges)) {
      const block = nextBlocks[blockId];
      if (!block || block.type !== 'target') continue;

      let start = r.startOffset;
      let end = r.endOffset;

      // 마지막 블록이면 길이 변화(delta)를 반영
      if (blockId === lastBlockId) {
        end = Math.max(start, Math.min(end + delta, currentLength));
      }

      // 범위 안전 체크
      start = Math.max(0, Math.min(start, currentLength));
      end = Math.max(start, Math.min(end, currentLength));

      const plain = targetDocument.slice(start, end);
      const html = toParagraphHtml(plain);
      nextBlocks[blockId] = {
        ...block,
        content: html,
        hash: hashContent(html),
        metadata: { ...block.metadata, updatedAt: now },
      };
    }
  };

  const applySourceFallback = (): void => {
    // sourceDocument가 비어있거나 초기화되지 않았으면 blocks 역투영 스킵
    // (기존 blocks 내용 유지)
    if (!sourceDocument || sourceDocument.length === 0) {
      return;
    }

    // 원본 blocks 기준으로 초기 offset을 계산하고,
    // 현재 sourceDocument 길이와의 차이를 마지막 블록에 적용합니다.
    const initialBuild = buildSourceDocument(project);
    const initialLength = initialBuild.text.length;
    const currentLength = sourceDocument.length;
    const delta = currentLength - initialLength;

    const blockIds = Object.keys(initialBuild.blockRanges);
    if (blockIds.length === 0) return; // 블록이 없으면 스킵

    const lastBlockId = blockIds[blockIds.length - 1];

    for (const [blockId, r] of Object.entries(initialBuild.blockRanges)) {
      const block = nextBlocks[blockId];
      if (!block || block.type !== 'source') continue;

      let start = r.startOffset;
      let end = r.endOffset;

      // 마지막 블록이면 길이 변화(delta)를 반영
      if (blockId === lastBlockId) {
        end = Math.max(start, Math.min(end + delta, currentLength));
      }

      // 범위 안전 체크
      start = Math.max(0, Math.min(start, currentLength));
      end = Math.max(start, Math.min(end, currentLength));

      const plain = sourceDocument.slice(start, end);
      const html = toParagraphHtml(plain);
      nextBlocks[blockId] = {
        ...block,
        content: html,
        hash: hashContent(html),
        metadata: { ...block.metadata, updatedAt: now },
      };
    }
  };

  const okTracked = applyTargetByTrackedRanges();
  if (!okTracked) {
    applyTargetFallback();
  }
  // Source는 tracked ranges 브릿지가 없으므로 항상 fallback으로 매핑
  applySourceFallback();

  return nextBlocks;
}

function scheduleWriteThroughSave(
  set: (partial: Partial<ProjectStore>) => void,
  get: () => ProjectStore,
): void {

  if (writeThroughTimer !== null) {
    window.clearTimeout(writeThroughTimer);
  }

  writeThroughTimer = window.setTimeout(() => {
    void (async () => {
      try {
        // 단일 문서(Target/Source) 편집은 blocks로 역투영이 필요하므로,
        // 직접 tauriSaveProject(project)를 호출하지 말고 store.saveProject()를 사용합니다.
        await get().saveProject();
      } catch (e) {
        // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
        const message = e instanceof Error ? e.message : 'Write-thru save failed';
        console.warn('[WriteThroughSave] Failed:', message);
        set({
          error: message,
          saveStatus: 'error',
          lastSaveError: e instanceof Error ? e.message : 'Write-thru save failed',
        });
      }
    })();
  }, WRITE_THROUGH_DELAY_MS);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toParagraphHtml(text: string): string {
  const trimmed = text.trim();
  // 실제 HTML 태그(<p>, <div>, <img ...> 등)가 존재하는지 확인
  if (/<[a-z][a-z0-9]*[\s/>]/i.test(trimmed)) {
    return text;
  }
  // 그 외의 경우에만 이스케이프 후 <p>로 감쌈
  const safe = escapeHtml(text);
  return `<p>${safe}</p>`;
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx < 0) {
    // 못 찾으면 전체 치환 대신 “전체 제안”으로 처리되도록 원문을 그대로 반환
    return replacement;
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}
