/**
 * translationPreviewActions 유닛 테스트 (L3)
 *
 * 검증 대상:
 * 1. apply 시점 projectId 재검증 — 프리뷰가 만들어진 프로젝트와 현재 프로젝트가 다르면 throw
 * 2. apply 시점 targetRevision 재검증 — set 이후 Target이 수정되었으면 throw
 * 3. 검증 통과 시 정상 적용 (replaceDocContent + clearPreview + 스냅샷)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashContent } from '@/utils/hash';

// ── mocks ───────────────────────────────────────────────────────────────────
vi.mock('@/i18n/config', () => ({
  default: { t: (key: string) => key },
}));

const replaceDocContentSpy = vi.fn();
vi.mock('@/editor/utils/replaceDocContent', () => ({
  replaceDocContent: (...args: unknown[]) => replaceDocContentSpy(...args),
}));

const projectStoreState: {
  project: { id: string; metadata: { title: string } } | null;
  targetDocJson: Record<string, unknown> | null;
  targetDocument: string;
  setTargetDocJson: ReturnType<typeof vi.fn>;
  setTargetDocument: ReturnType<typeof vi.fn>;
  materializeBlocksForSnapshot: ReturnType<typeof vi.fn>;
} = {
  project: null,
  targetDocJson: null,
  targetDocument: '',
  setTargetDocJson: vi.fn(),
  setTargetDocument: vi.fn(),
  materializeBlocksForSnapshot: vi.fn(() => ({})),
};

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => projectStoreState,
  },
}));

const editorStoreState: { sourceEditor: unknown; targetEditor: { isDestroyed: boolean; getJSON: () => Record<string, unknown> } | null } = {
  sourceEditor: null,
  targetEditor: null,
};

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => editorStoreState,
  },
}));

const createSnapshotIfChangedSpy = vi.fn(async () => undefined);
vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({ createSnapshotIfChanged: createSnapshotIfChangedSpy }),
  },
}));

vi.mock('@/stores/aiConfigStore', () => ({
  useAiConfigStore: {
    getState: () => ({ translationModel: 'test-model' }),
  },
}));

// markdown 변환은 결정론적 직렬화로 대체 — revision 계산이 docJson 내용에 정확히 종속되게 한다
vi.mock('@/utils/markdownConverter', () => ({
  tipTapJsonToMarkdownForTranslation: (json: unknown) => JSON.stringify(json),
  htmlToTipTapJson: (html: string) => ({ type: 'doc', html }),
  tipTapJsonToHtml: () => '<p>converted</p>',
}));

import {
  applyDesktopTranslationPreview,
  DesktopPreviewApplyError,
  computeCurrentTargetRevision,
} from './translationPreviewActions';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';

const PREVIEW_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const CURRENT_TARGET_DOC = { type: 'doc', content: [] };

function currentRevision(): string {
  return hashContent(JSON.stringify(CURRENT_TARGET_DOC));
}

describe('applyDesktopTranslationPreview — L3 재검증 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTranslationPreviewStore.getState().clearPreview();
    projectStoreState.project = { id: 'project-A', metadata: { title: 'A' } };
    projectStoreState.targetDocJson = CURRENT_TARGET_DOC;
    projectStoreState.targetDocument = '<p>current</p>';
    projectStoreState.materializeBlocksForSnapshot.mockReturnValue({});
    editorStoreState.targetEditor = {
      isDestroyed: false,
      getJSON: () => CURRENT_TARGET_DOC,
    };
  });

  it('프리뷰가 없으면 no_preview 에러', async () => {
    await expect(applyDesktopTranslationPreview()).rejects.toMatchObject({
      name: 'DesktopPreviewApplyError',
      code: 'no_preview',
    });
  });

  it('프리뷰의 projectId가 현재 프로젝트와 다르면 project_mismatch로 거부하고 문서를 건드리지 않는다', async () => {
    useTranslationPreviewStore.getState().setPreview({
      docJson: PREVIEW_DOC,
      projectId: 'project-B',
      targetRevision: currentRevision(),
    });

    await expect(applyDesktopTranslationPreview()).rejects.toMatchObject({
      code: 'project_mismatch',
    });
    expect(replaceDocContentSpy).not.toHaveBeenCalled();
    expect(createSnapshotIfChangedSpy).not.toHaveBeenCalled();
    // 거부 시 프리뷰는 유지 (discard는 호출자/전환 경로가 결정)
    expect(useTranslationPreviewStore.getState().open).toBe(true);
  });

  it('set 이후 Target이 수정되었으면(revision 불일치) revision_mismatch로 거부', async () => {
    useTranslationPreviewStore.getState().setPreview({
      docJson: PREVIEW_DOC,
      projectId: 'project-A',
      targetRevision: 'stale-revision',
    });

    await expect(applyDesktopTranslationPreview()).rejects.toMatchObject({
      code: 'revision_mismatch',
    });
    expect(replaceDocContentSpy).not.toHaveBeenCalled();
  });

  it('projectId/revision이 일치하면 적용: replaceDocContent + clearPreview + 스냅샷', async () => {
    useTranslationPreviewStore.getState().setPreview({
      docJson: PREVIEW_DOC,
      projectId: 'project-A',
      targetRevision: currentRevision(),
    });

    await applyDesktopTranslationPreview();

    expect(replaceDocContentSpy).toHaveBeenCalledWith(
      editorStoreState.targetEditor,
      PREVIEW_DOC,
      { addToHistory: true },
    );
    expect(useTranslationPreviewStore.getState().open).toBe(false);
    expect(createSnapshotIfChangedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-A' }),
    );
  });

  it('projectId가 기록되지 않은 레거시 프리뷰(null)는 revision 검증만 수행 (하위 호환)', async () => {
    useTranslationPreviewStore.getState().setPreview({
      docJson: PREVIEW_DOC,
      targetRevision: currentRevision(),
    });

    await applyDesktopTranslationPreview();
    expect(replaceDocContentSpy).toHaveBeenCalledTimes(1);
  });

  it('DesktopPreviewApplyError는 code를 보존한다', () => {
    const err = new DesktopPreviewApplyError('revision_mismatch', 'msg');
    expect(err.code).toBe('revision_mismatch');
    expect(err.name).toBe('DesktopPreviewApplyError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('computeCurrentTargetRevision', () => {
  beforeEach(() => {
    projectStoreState.targetDocJson = CURRENT_TARGET_DOC;
    projectStoreState.targetDocument = '<p>current</p>';
  });

  it('살아있는 target 에디터가 있으면 에디터 JSON 기준으로 계산 (디바운스 stale 캐시 회피)', () => {
    const editorDoc = { type: 'doc', content: [{ type: 'paragraph', text: 'live' }] };
    editorStoreState.targetEditor = { isDestroyed: false, getJSON: () => editorDoc };
    expect(computeCurrentTargetRevision()).toBe(hashContent(JSON.stringify(editorDoc)));
  });

  it('에디터가 없으면 store 캐시(targetDocJson)로 폴백', () => {
    editorStoreState.targetEditor = null;
    expect(computeCurrentTargetRevision()).toBe(hashContent(JSON.stringify(CURRENT_TARGET_DOC)));
  });

  it('JSON 캐시도 없으면 HTML을 변환해 계산', () => {
    editorStoreState.targetEditor = null;
    projectStoreState.targetDocJson = null;
    const expected = hashContent(JSON.stringify({ type: 'doc', html: '<p>current</p>' }));
    expect(computeCurrentTargetRevision()).toBe(expected);
  });
});
