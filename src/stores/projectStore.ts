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
import { hashContent, stripHtml } from '@/utils/hash';
import { loadProject as tauriLoadProject, saveProject as tauriSaveProject } from '@/tauri/project';
import { listProjectIds as tauriListProjectIds } from '@/tauri/storage';
import { createDiffResult, diffToHtml, applyDiff } from '@/utils/diff';
import { buildTargetDocument } from '@/editor/targetDocument';
import { buildSourceDocument } from '@/editor/sourceDocument';

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
   * Target 단일 문서에서 Apply를 위한 pending diff (1차: offset 기반)
   */
  pendingDocDiff: null | {
    startOffset: number;
    endOffset: number;
    originalText: string;
    suggestedText: string;
    sessionId?: string;
    /**
     * Monaco tracked range decoration id (비영속)
     * - 사용자가 다른 곳을 편집해도 범위가 따라가도록, accept 시점에 최신 offset을 재계산하는 용도
     */
    trackedDecorationId?: string;
    /**
     * 어떤 assistant message로부터 생성되었는지(연결용)
     */
    originMessageId?: string;
  };

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
  initializeProject: () => void;
  loadProject: (project: ITEProject) => void;
  createNewProject: (metadata: Partial<ProjectMetadata>) => void;
  saveProject: () => Promise<void>;
  switchProjectById: (projectId: string) => Promise<void>;
  updateGlossaryPaths: (paths: string[]) => void;
  addGlossaryPath: (path: string) => void;
  startAutoSave: () => void;
  stopAutoSave: () => void;

  // Target 단일 문서
  setTargetDocument: (next: string) => void;
  setSourceDocument: (next: string) => void;
  setTargetLanguage: (lang: string) => void;
  rebuildTargetDocument: () => void;
  rebuildSourceDocument: () => void;

  // Diff preview (Target 단일 문서)
  openDocDiffPreview: (params: {
    startOffset: number;
    endOffset: number;
    suggestedText: string;
    originMessageId?: string;
  }) => void;
  setPendingDocDiffTrackedDecorationId: (params: { sessionId: string; decorationId: string }) => void;
  acceptDocDiff: () => void;
  rejectDocDiff: () => void;
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
let writeThroughTimer: number | null = null;

let autoSaveTimer: number | null = null;
let autoSaveInFlight = false;

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
      content: '<p>Hello, welcome to the Integrated Translation Editor.</p>',
      hash: hashContent('Hello, welcome to the Integrated Translation Editor.'),
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
    history: [],
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
      pendingDocDiff: null,
      targetDocHandle: null,
      editSessions: [],
      applyAnchor: null,

      // 프로젝트 초기화
      initializeProject: (): void => {
        set({ isLoading: true, error: null });
        void (async () => {
          const { lastProjectId } = get();

          if (lastProjectId) {
            try {
              const loaded = await tauriLoadProject(lastProjectId);
              const td = buildTargetDocument(loaded);
              set({
                project: loaded,
                isDirty: false,
                isLoading: false,
                error: null,
                targetDocument: td.text,
                sourceDocument: buildSourceDocument(loaded).text,
              });
              return;
            } catch {
              // 로드 실패 시 무시
            }
          }

          // lastProjectId가 없거나 로드 실패한 경우: DB에 저장된 최근 프로젝트를 우선 로드
          try {
            const ids = await tauriListProjectIds();
            const first = ids[0];
            if (first) {
              const loaded = await tauriLoadProject(first);
              const td = buildTargetDocument(loaded);
              set({
                project: loaded,
                isDirty: false,
                isLoading: false,
                error: null,
                lastProjectId: loaded.id,
                targetDocument: td.text,
                sourceDocument: buildSourceDocument(loaded).text,
              });
              return;
            }
          } catch {
            // Tauri runtime 미탐지/DB 조회 실패 등은 폴백으로 처리
          }

          // 프로젝트가 하나도 없는 경우: null 유지 (Blank Page UX를 위함)
          set({
            project: null,
            isLoading: false,
            lastProjectId: null,
          });
        })();
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
                console.warn('[AutoSave] Failed:', err);
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

      // 프로젝트 로드
      // 주의: 이전 프로젝트가 dirty면 저장하지 않고 바로 덮어씁니다.
      // 이전 프로젝트를 저장하려면 호출 전에 saveProject()를 먼저 호출하거나,
      // switchProjectById()를 사용하세요.
      loadProject: (project: ITEProject): void => {
        // write-through 타이머 취소 (이전 프로젝트가 새 프로젝트 상태로 저장되는 것 방지)
        if (writeThroughTimer !== null) {
          window.clearTimeout(writeThroughTimer);
          writeThroughTimer = null;
        }

        const td = buildTargetDocument(project);
        set({
          project,
          isDirty: false,
          isLoading: false,
          error: null,
          lastProjectId: project.id,
          targetDocument: td.text,
          sourceDocument: buildSourceDocument(project).text,
          // pendingDocDiff 초기화 (이전 프로젝트의 diff가 남아있으면 문제)
          pendingDocDiff: null,
        });
      },

      // 새 프로젝트 생성
      createNewProject: (metadata: Partial<ProjectMetadata>): void => {
        const { project, isDirty, stopAutoSave, startAutoSave } = get();

        // 기존 프로젝트가 있고 변경사항이 있으면 먼저 저장
        if (project && isDirty) {
          stopAutoSave();
          void (async () => {
            try {
              await get().saveProject();
            } catch (e) {
              console.warn('[createNewProject] Failed to save previous project:', e);
            }
            // 저장 후 새 프로젝트 생성 진행
            createAndSetNewProject();
            startAutoSave();
          })();
        } else {
          createAndSetNewProject();
        }

        function createAndSetNewProject(): void {
          const initialProject = createInitialProject();
          const nextProject: ITEProject = {
            ...initialProject,
            metadata: {
              ...initialProject.metadata,
              ...metadata,
            },
          };
          const td = buildTargetDocument(nextProject);
          set({
            project: nextProject,
            isDirty: true,
            lastProjectId: initialProject.id,
            targetDocument: td.text,
            sourceDocument: buildSourceDocument(nextProject).text,
          });
          scheduleWriteThroughSave(set, get);
        }
      },

      // 프로젝트 저장 (Tauri 백엔드 호출 예정)
      saveProject: async (): Promise<void> => {
        const { project, targetDocument, sourceDocument, targetDocHandle } = get();

        console.log('[saveProject] called', {
          hasProject: !!project,
          projectId: project?.id,
          targetDocLength: targetDocument?.length,
          sourceDocLength: sourceDocument?.length,
          hasTargetDocHandle: !!targetDocHandle,
        });

        if (!project) {
          console.warn('[saveProject] No project, returning');
          return;
        }

        set({ isLoading: true, saveStatus: 'saving', lastSaveError: null });

        try {
          const now = Date.now();
          // 저장 직전: Target/Source 단일 문서 내용을 blocks로 역투영
          // 1) 가능하면 tracked ranges 기반(정확)
          // 2) 실패/미설정 시 segment/ids 기반 fallback(저장 누락 방지)
          let nextBlocks: Record<string, EditorBlock> = { ...project.blocks };

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
          console.log('[saveProject] applyTargetByTrackedRanges result:', okTracked);
          if (!okTracked) {
            console.log('[saveProject] Using applyTargetFallback');
            applyTargetFallback();
          }
          // Source는 tracked ranges 브릿지가 없으므로 항상 fallback으로 매핑
          applySourceFallback();

          const projectToSave: ITEProject = {
            ...project,
            blocks: nextBlocks,
            metadata: {
              ...project.metadata,
              updatedAt: now,
            },
          };

          console.log('[saveProject] Calling tauriSaveProject...', {
            projectId: projectToSave.id,
            blocksCount: Object.keys(nextBlocks).length,
            targetBlocksSample: Object.values(nextBlocks)
              .filter(b => b.type === 'target')
              .slice(0, 2)
              .map(b => ({ id: b.id, contentLength: b.content.length, content: b.content.slice(0, 100) })),
          });

          await tauriSaveProject(projectToSave);

          console.log('[saveProject] SUCCESS - saved project:', projectToSave.id);

          set({
            project: projectToSave,
            isDirty: false,
            isLoading: false,
            saveStatus: 'idle',
            lastSavedAt: Date.now(),
            lastProjectId: projectToSave.id,
          });
        } catch (error) {
          console.error('[saveProject] FAILED:', error);
          set({
            error: error instanceof Error ? error.message : 'Failed to save project',
            isLoading: false,
            saveStatus: 'error',
            lastSaveError: error instanceof Error ? error.message : 'Failed to save project',
          });
        }
      },

      // 프로젝트 전환(auto-save-and-switch)
      switchProjectById: async (projectId: string): Promise<void> => {
        const { project, isDirty, stopAutoSave, startAutoSave, saveProject, loadProject } = get();
        if (!projectId) return;
        if (project?.id === projectId) return;

        stopAutoSave();
        set({ isLoading: true, error: null });

        try {
          if (isDirty) {
            await saveProject();
            // saveProject는 내부에서 catch를 삼키므로, 상태로 실패 여부를 확인
            const { saveStatus, lastSaveError } = get();
            if (saveStatus === 'error') {
              throw new Error(lastSaveError || 'Failed to save project before switching');
            }
          }

          const loaded = await tauriLoadProject(projectId);
          loadProject(loaded);
        } catch (e) {
          set({
            error: e instanceof Error ? e.message : 'Failed to switch project',
            isLoading: false,
          });
        } finally {
          startAutoSave();
        }
      },

      setTargetDocument: (next: string): void => {
        console.log('[setTargetDocument] called, length:', next?.length);
        set({ targetDocument: next, isDirty: true, lastChangeAt: Date.now() });
        scheduleWriteThroughSave(set, get);
      },

      setSourceDocument: (next: string): void => {
        set({ sourceDocument: next, isDirty: true, lastChangeAt: Date.now() });
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

      openDocDiffPreview: (params): void => {
        const { targetDocument, editSessions } = get();
        const sessionId = uuidv4();
        const start = Math.max(0, Math.min(params.startOffset, targetDocument.length));
        const end = Math.max(start, Math.min(params.endOffset, targetDocument.length));
        const originalText = targetDocument.slice(start, end);

        const diff = createDiffResult(sessionId, originalText, params.suggestedText);

        set({
          pendingDocDiff: {
            startOffset: start,
            endOffset: end,
            originalText,
            suggestedText: params.suggestedText,
            sessionId,
            ...(params.originMessageId ? { originMessageId: params.originMessageId } : {}),
          },
          editSessions: [
            ...editSessions,
            {
              id: sessionId,
              createdAt: Date.now(),
              kind: 'edit',
              target: 'targetDocument',
              anchorRange: { startOffset: start, endOffset: end },
              baseText: originalText,
              suggestedText: params.suggestedText,
              diff,
              status: 'pending',
              ...(params.originMessageId ? { originMessageId: params.originMessageId } : {}),
            },
          ],
        });
      },

      setPendingDocDiffTrackedDecorationId: ({ sessionId, decorationId }): void => {
        const { pendingDocDiff } = get();
        if (!pendingDocDiff) return;
        if (pendingDocDiff.sessionId !== sessionId) return;
        set({
          pendingDocDiff: {
            ...pendingDocDiff,
            trackedDecorationId: decorationId,
          },
        });
      },

      acceptDocDiff: (): void => {
        const { pendingDocDiff, targetDocument, targetDocHandle } = get();
        if (!pendingDocDiff) return;
        const { startOffset, endOffset, suggestedText, sessionId, trackedDecorationId } = pendingDocDiff;

        const resolved =
          trackedDecorationId && targetDocHandle?.getDecorationOffsets
            ? targetDocHandle.getDecorationOffsets(trackedDecorationId)
            : null;

        const start = Math.max(
          0,
          Math.min(resolved?.startOffset ?? startOffset, targetDocument.length),
        );
        const end = Math.max(
          start,
          Math.min(resolved?.endOffset ?? endOffset, targetDocument.length),
        );
        const next =
          targetDocument.slice(0, start) + suggestedText + targetDocument.slice(end);

        set({
          targetDocument: next,
          pendingDocDiff: null,
          isDirty: true,
        });

        if (sessionId) {
          get().finalizeEditSession({ sessionId, status: 'kept' });
        }
      },

      rejectDocDiff: (): void => {
        const { pendingDocDiff } = get();
        set({ pendingDocDiff: null });
        const sessionId = pendingDocDiff?.sessionId;
        if (sessionId) {
          get().finalizeEditSession({ sessionId, status: 'discarded' });
        }
      },

      finalizeEditSession: ({ sessionId, status }): void => {
        const { editSessions } = get();
        const idx = editSessions.findIndex((s) => s.id === sessionId);
        if (idx < 0) return;
        const cur = editSessions[idx];
        if (!cur || cur.status !== 'pending') return;
        const next = { ...cur, status };
        const updated = [...editSessions];
        updated[idx] = next;
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
        delete pendingDiffs[blockId];
        set({ pendingDiffs: { ...pendingDiffs } });
        get().updateBlock(blockId, finalHtml);
      },

      rejectDiff: (blockId: string): void => {
        const { pendingDiffs, project } = get();
        if (!project) return;
        const pending = pendingDiffs[blockId];
        if (!pending) return;

        // revert: 원본 HTML로 복원 (store에 저장해둔 originalHtml)
        const originalHtml = pending.originalHtml;
        delete pendingDiffs[blockId];

        set({
          pendingDiffs: { ...pendingDiffs },
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
          content: `<p>${sourceContent}</p>`,
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
          content: `<p>${targetContent}</p>`,
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

function scheduleWriteThroughSave(
  set: (partial: Partial<ProjectStore>) => void,
  get: () => ProjectStore,
): void {
  console.log('[scheduleWriteThroughSave] scheduling save in', WRITE_THROUGH_DELAY_MS, 'ms');

  if (writeThroughTimer !== null) {
    window.clearTimeout(writeThroughTimer);
  }

  writeThroughTimer = window.setTimeout(() => {
    console.log('[scheduleWriteThroughSave] timer fired, calling saveProject');
    void (async () => {
      try {
        // 단일 문서(Target/Source) 편집은 blocks로 역투영이 필요하므로,
        // 직접 tauriSaveProject(project)를 호출하지 말고 store.saveProject()를 사용합니다.
        await get().saveProject();
      } catch (e) {
        console.warn('[WriteThroughSave] Failed:', e);
        set({
          error: e instanceof Error ? e.message : 'Write-thru save failed',
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
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toParagraphHtml(text: string): string {
  const trimmed = text.trim();
  // 이미 HTML 태그로 감싸져 있다면 그대로 반환
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
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

