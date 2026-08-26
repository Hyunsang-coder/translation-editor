import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useShallow } from 'zustand/shallow';
import { Lock, TriangleAlert } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { alignUnits, type AlignOp } from '@/utils/alignUnits';
import { languageShortCode, resolveDirection } from '@/utils/detectLanguage';
import { AlignmentRow } from '@/components/editor/AlignmentRow';
import {
  useAlignmentAnnotations,
  type UnitAnnotations,
} from '@/components/editor/useAlignmentAnnotations';
import type { TranslationUnit, TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';
import type { IssueSeverity } from '@/stores/reviewStore';
import { CAPTION } from '@/constants/styles';

interface NumberedOp {
  op: AlignOp;
  /** ops 기준 1-based 번호 */
  number: number;
}

type RenderBlock =
  | { kind: 'pair'; op: Extract<AlignOp, { kind: 'pair' }>; number: number }
  | { kind: 'mismatch'; items: NumberedOp[] };

/** 연속된 불일치를 한 구간으로 묶는다. 정상 쌍은 행 하나가 곧 블록 하나. */
function groupIntoBlocks(ops: AlignOp[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];

  ops.forEach((op, index) => {
    if (op.kind === 'pair') {
      blocks.push({ kind: 'pair', op, number: index + 1 });
      return;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'mismatch') {
      last.items.push({ op, number: index + 1 });
    } else {
      blocks.push({ kind: 'mismatch', items: [{ op, number: index + 1 }] });
    }
  });

  return blocks;
}

function rowKey(number: number, unit: TranslationUnit): string {
  return `${number}-${unit.id ?? unit.path.join('.')}`;
}

/**
 * 문서 보기로 전환하고 해당 문단에 커서를 놓는다.
 *
 * `scrollIntoView()`를 쓰지 않는다(앱 규칙) — `setTextSelection` + `focus()`가
 * ProseMirror의 자체 스크롤 로직을 태우므로 그것으로 충분하다.
 */
function jumpToUnit(unitId: string, field: 'source' | 'target'): void {
  const editor = field === 'source'
    ? useEditorStore.getState().sourceEditor
    : useEditorStore.getState().targetEditor;
  if (!editor || editor.isDestroyed) return;

  let pos: number | null = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos !== null) return false;
    if (node.attrs?.translationUnitId === unitId) {
      pos = nodePos + 1;
      return false;
    }
    return true;
  });
  if (pos === null) return;

  useUIStore.getState().setEditorViewMode('document');
  // 모드 전환 후 에디터가 다시 보이게 될 때까지 한 프레임 기다린다
  requestAnimationFrame(() => {
    editor.chain().focus().setTextSelection(pos!).run();
  });
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 3, major: 2, minor: 1 };

function pickTopSeverity(a: IssueSeverity | null, b: IssueSeverity | null): IssueSeverity | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a]! >= SEVERITY_RANK[b]! ? a : b;
}

/** 구간의 첫 유닛 — 배너의 "문서 보기로 열기"가 향할 곳. */
function firstUnitOf(block: Extract<RenderBlock, { kind: 'mismatch' }>): {
  id: string;
  field: 'source' | 'target';
} | null {
  for (const { op } of block.items) {
    const unit = op.kind === 'target-only' ? op.target : op.source;
    const field = op.kind === 'target-only' ? 'target' : 'source';
    if (unit.id) return { id: unit.id, field };
  }
  return null;
}

/**
 * 구간 배너 문구. 어느 쪽이 남는지에 따라 다르게 읽히도록 세 갈래로 나눈다.
 * 괄호 안 수치는 문서 전체의 유닛 수 — 구간 수치만으로는 규모를 가늠할 수 없다.
 */
function mismatchHeadline(
  t: TFunction,
  block: Extract<RenderBlock, { kind: 'mismatch' }>,
  totals: { source: number; target: number },
): string {
  const sourceOnly = block.items.filter(({ op }) => op.kind === 'source-only').length;
  const targetOnly = block.items.length - sourceOnly;
  const counts = { sourceTotal: totals.source, targetTotal: totals.target };

  if (sourceOnly === 0) {
    return t('editor.alignment.mismatch.extraTarget', { count: targetOnly, ...counts });
  }
  if (targetOnly === 0) {
    return t('editor.alignment.mismatch.extraSource', { count: sourceOnly, ...counts });
  }
  return t('editor.alignment.mismatch.both', { sourceCount: sourceOnly, targetCount: targetOnly, ...counts });
}

const EMPTY_DOC: TranslationUnitDocument = { type: 'doc', content: [] };

/** 문서가 조용해진 뒤에만 정렬을 다시 계산한다 (스펙 §7 — onUpdate에 걸지 말 것). */
const RECOMPUTE_DEBOUNCE_MS = 300;

const HEADER_CELL_CLASS = `${CAPTION} flex items-center`;

function columnLabel(base: string, language: string | null): string {
  const code = languageShortCode(language);
  return code ? `${base} · ${code}` : base;
}

/**
 * 정렬 검사 뷰 — 원문/번역문 문단을 나란히 놓는 **읽기 전용** 대조 테이블.
 *
 * 정렬은 저장하지 않는다. 뷰를 열 때마다 두 문서의 현재 JSON에서 계산하고,
 * 짝이 맞지 않는 구간은 고치지 않고 불일치로 표시한다(4단계).
 * 여기서 TipTap 에디터를 만들지 않는다 — 편집은 문서 보기에서 한다.
 */
export function AlignmentView(): JSX.Element {
  const { t } = useTranslation();

  const { sourceDocJson, targetDocJson, sourceLanguage: storedSourceLanguage, targetLanguage } = useProjectStore(
    useShallow((s) => ({
      sourceDocJson: s.sourceDocJson,
      targetDocJson: s.targetDocJson,
      sourceLanguage: s.project?.metadata.sourceLanguage ?? null,
      targetLanguage: s.project?.metadata.targetLanguage ?? null,
    }))
  );

  const activeAlignmentUnitId = useUIStore((s) => s.activeAlignmentUnitId);
  const setActiveAlignmentUnitId = useUIStore((s) => s.setActiveAlignmentUnitId);

  // 뷰가 열려 있는 동안 문서가 바뀌는 경로는 번역·검수 적용 같은 단발 이벤트뿐이라
  // 디바운스된 스냅샷으로 충분하다. 리비전 해시로 한 번 더 거르지 않는 이유는
  // markdown 변환 + 해시 비용이 정렬 계산 자체보다 싸지 않기 때문이다.
  const [docs, setDocs] = useState(() => ({ source: sourceDocJson, target: targetDocJson }));

  useEffect(() => {
    if (docs.source === sourceDocJson && docs.target === targetDocJson) return;
    const timer = window.setTimeout(() => {
      setDocs({ source: sourceDocJson, target: targetDocJson });
    }, RECOMPUTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sourceDocJson, targetDocJson, docs]);

  const alignResult = useMemo(
    () => alignUnits(
      (docs.source as TranslationUnitDocument | null) ?? EMPTY_DOC,
      (docs.target as TranslationUnitDocument | null) ?? EMPTY_DOC,
    ),
    [docs]
  );

  // 연속된 불일치는 하나의 "구간"으로 묶어 배너와 함께 보여준다 (§4.3).
  const blocks = useMemo(() => groupIntoBlocks(alignResult.ops), [alignResult]);

  const totals = useMemo(() => alignResult.ops.reduce(
    (acc, op) => ({
      source: acc.source + (op.kind === 'target-only' ? 0 : 1),
      target: acc.target + (op.kind === 'source-only' ? 0 : 1),
    }),
    { source: 0, target: 0 }
  ), [alignResult]);

  const annotations = useAlignmentAnnotations(alignResult.ops);

  /** 한 행의 배지 — 원문 쪽 코멘트와 번역문 쪽 이슈·코멘트를 합친다 */
  const annotationsFor = (op: AlignOp): UnitAnnotations | null => {
    const ids = [
      op.kind === 'target-only' ? null : op.source.id,
      op.kind === 'source-only' ? null : op.target.id,
    ].filter((id): id is string => Boolean(id));

    const entries = ids
      .map((id) => annotations.byUnitId.get(id))
      .filter((entry): entry is UnitAnnotations => entry !== undefined);
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0]!;

    return entries.reduce((merged, entry) => ({
      issueCount: merged.issueCount + entry.issueCount,
      commentCount: merged.commentCount + entry.commentCount,
      topSeverity: pickTopSeverity(merged.topSeverity, entry.topSeverity),
    }));
  };

  const pairedPercent = alignResult.totalUnits === 0
    ? 100
    : Math.round((alignResult.pairedCount / alignResult.totalUnits) * 100);

  const sourceSample = useMemo(
    () =>
      alignResult.ops
        .flatMap((op) => (op.kind === 'target-only' ? [] : [op.source.text]))
        .slice(0, 20)
        .join(' '),
    [alignResult],
  );

  // 설정이 '자동'이면 헤더에도 실제로 풀린 언어를 보여준다 (센티널 'auto'가 그대로 뜨지 않게)
  const direction = useMemo(
    () => resolveDirection({ source: storedSourceLanguage, target: targetLanguage }, sourceSample),
    [storedSourceLanguage, targetLanguage, sourceSample],
  );
  const sourceLanguage = direction.source.language;
  const resolvedTargetLanguage = direction.target.language;

  return (
    <div className="h-full flex flex-col bg-editor-surface" data-testid="alignment-view">
      {/* 이 뷰의 성격을 먼저 밝힌다 — 여기서는 고칠 수 없다 */}
      <div className="h-9 shrink-0 px-[18px] flex items-center border-b border-editor-hairline">
        <span className="h-6 px-[9px] inline-flex items-center gap-1.5 bg-editor-surface border border-editor-border rounded text-[11px] font-semibold text-editor-muted">
          <Lock size={12} />
          {t('editor.alignment.readOnly')}
        </span>
      </div>

      {/* 행 목록 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/*
          테이블 헤더는 스크롤 컨테이너 *안*에 둔다 — 밖에 두면 스크롤바 폭만큼
          본문만 좁아져 열 경계가 헤더와 어긋난다. 패딩도 행 셀과 같은 값이어야 한다.
        */}
        <div
          className="sticky top-0 z-10 h-8 flex items-stretch border-b border-editor-hairline bg-editor-bg"
          role="row"
        >
          <div className={`w-[52px] shrink-0 pl-[18px] ${HEADER_CELL_CLASS}`}>#</div>
          <div className={`flex-1 min-w-0 pl-5 border-l border-editor-hairline ${HEADER_CELL_CLASS}`}>
            {columnLabel(t('editor.alignment.sourceColumn'), sourceLanguage)}
          </div>
          <div className={`flex-1 min-w-0 pl-5 border-l border-editor-hairline ${HEADER_CELL_CLASS}`}>
            {columnLabel(t('editor.alignment.targetColumn'), resolvedTargetLanguage)}
          </div>
          <div className={`w-[120px] shrink-0 pl-[14px] border-l border-editor-hairline ${HEADER_CELL_CLASS}`}>
            {t('editor.alignment.alignColumn')}
          </div>
        </div>

        {blocks.length === 0 ? (
          <div className="px-[18px] py-6 text-sm text-editor-muted">
            {t('editor.alignment.empty')}
          </div>
        ) : (
          blocks.map((block) => {
            if (block.kind === 'pair') {
              const unitId = block.op.target.id ?? null;
              return (
                <AlignmentRow
                  key={rowKey(block.number, block.op.target)}
                  index={block.number}
                  op={block.op}
                  active={unitId !== null && unitId === activeAlignmentUnitId}
                  onSelect={() => setActiveAlignmentUnitId(unitId)}
                  onEdit={unitId === null ? null : () => jumpToUnit(unitId, 'target')}
                  annotations={annotationsFor(block.op)}
                />
              );
            }

            return (
              <div
                key={`mismatch-${block.items[0]?.number ?? 0}`}
                className="bg-severity-major/[0.06] border-b border-editor-hairline/40"
                data-testid="alignment-mismatch-band"
              >
                <div className="flex items-center gap-2.5 px-[18px] py-2 border-b border-dashed border-severity-major/60">
                  <TriangleAlert size={15} className="shrink-0 text-severity-major" />
                  <span className="text-xs font-bold text-severity-major">
                    {mismatchHeadline(t, block, totals)}
                  </span>
                  <span className="text-[11px] text-severity-major">
                    {t('editor.alignment.mismatch.note')}
                  </span>
                  {(() => {
                    const entry = firstUnitOf(block);
                    if (!entry) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => jumpToUnit(entry.id, entry.field)}
                        className="ml-auto h-6 px-2.5 shrink-0 border border-severity-major bg-editor-bg rounded text-[11px] font-bold text-severity-major-deep hover:bg-severity-major/10 active:scale-95 transition-colors"
                        data-testid="alignment-band-open"
                      >
                        {t('editor.alignment.mismatch.openInDocument')}
                      </button>
                    );
                  })()}
                </div>
                {block.items.map(({ op, number }) => (
                  <AlignmentRow
                    key={rowKey(number, op.kind === 'target-only' ? op.target : op.source)}
                    index={number}
                    op={op}
                    active={false}
                    onSelect={null}
                    onEdit={null}
                    annotations={annotationsFor(op)}
                  />
                ))}
              </div>
            );
          })
        )}

        {/* 매핑 실패한 이슈는 버리지 않는다 — 이 수치 자체가 정렬 품질 지표다 */}
        {annotations.unmappedIssueCount > 0 && (
          <button
            type="button"
            onClick={() => useUIStore.getState().openReviewPanel()}
            className="w-full px-[18px] py-3 text-left text-xs text-editor-muted hover:bg-editor-bg transition-colors"
            data-testid="alignment-unmapped-issues"
          >
            {t('editor.alignment.unmappedIssues', { count: annotations.unmappedIssueCount })}
          </button>
        )}
      </div>

      {/* 하단 정렬 요약 */}
      <div className="h-14 shrink-0 border-t border-editor-hairline bg-editor-surface flex items-center gap-[18px] px-[18px]">
        <span className={`${CAPTION} shrink-0`}>
          {t('editor.alignment.summaryLabel')}
        </span>
        <span className="text-sm font-bold shrink-0">
          {t('editor.alignment.summaryTotal', { count: alignResult.totalUnits })}
          <span className="mx-1.5 text-editor-muted font-normal">·</span>
          <span className="text-primary-500">
            {t('editor.alignment.summaryPaired', { count: alignResult.pairedCount })}
          </span>
          <span className="mx-1.5 text-editor-muted font-normal">·</span>
          <span className="text-severity-major">
            {t('editor.alignment.summaryMismatched', { count: alignResult.mismatchCount })}
          </span>
        </span>

        <span className="flex-1 max-w-[420px] h-2 bg-editor-border rounded overflow-hidden flex" aria-hidden="true">
          <span className="h-full bg-primary-fill" style={{ width: `${pairedPercent}%` }} />
          <span className="h-full bg-severity-major/70" style={{ width: `${100 - pairedPercent}%` }} />
        </span>

        {/* degraded를 조용히 넘기지 않는다 — 순번 폴백 결과를 정상으로 믿게 두면 안 된다 */}
        {alignResult.degraded && (
          <span className="text-[11px] font-semibold text-severity-major shrink-0" data-testid="alignment-degraded">
            {t('editor.alignment.degraded')}
          </span>
        )}
      </div>
    </div>
  );
}
