import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Lock } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { alignUnits } from '@/utils/alignUnits';
import { detectSourceLanguage, languageShortCode } from '@/utils/detectLanguage';
import { AlignmentRow } from '@/components/editor/AlignmentRow';
import type { TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';

const EMPTY_DOC: TranslationUnitDocument = { type: 'doc', content: [] };

/** 문서가 조용해진 뒤에만 정렬을 다시 계산한다 (스펙 §7 — onUpdate에 걸지 말 것). */
const RECOMPUTE_DEBOUNCE_MS = 300;

const HEADER_CELL_CLASS =
  'text-[10px] font-extrabold tracking-[.12em] uppercase text-editor-muted flex items-center';

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

  const { sourceDocJson, targetDocJson, targetLanguage } = useProjectStore(
    useShallow((s) => ({
      sourceDocJson: s.sourceDocJson,
      targetDocJson: s.targetDocJson,
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

  const pairs = useMemo(
    () => alignResult.ops.flatMap((op, index) => (
      op.kind === 'pair' ? [{ op, number: index + 1 }] : []
    )),
    [alignResult]
  );

  const sourceLanguage = useMemo(() => {
    const sample = alignResult.ops
      .flatMap((op) => (op.kind === 'target-only' ? [] : [op.source.text]))
      .slice(0, 3)
      .join(' ');
    return sample.trim() ? detectSourceLanguage(sample) : null;
  }, [alignResult]);

  return (
    <div className="h-full flex flex-col bg-editor-surface" data-testid="alignment-view">
      {/* 이 뷰의 성격을 먼저 밝힌다 — 여기서는 고칠 수 없다 */}
      <div className="h-9 shrink-0 px-[18px] flex items-center border-b border-editor-border">
        <span className="h-6 px-[9px] inline-flex items-center gap-1.5 bg-editor-surface border border-editor-border rounded text-[11px] font-semibold text-editor-muted">
          <Lock size={12} />
          {t('editor.alignment.readOnly', '읽기 전용')}
        </span>
      </div>

      {/* 테이블 헤더 */}
      <div
        className="h-8 shrink-0 flex items-stretch border-b border-editor-border bg-editor-bg"
        role="row"
      >
        <div className={`w-[52px] shrink-0 pl-[18px] ${HEADER_CELL_CLASS}`}>#</div>
        <div className={`flex-1 min-w-0 pl-[18px] border-l border-editor-border ${HEADER_CELL_CLASS}`}>
          {columnLabel(t('editor.alignment.sourceColumn', '원문'), sourceLanguage)}
        </div>
        <div className={`flex-1 min-w-0 pl-[18px] border-l border-editor-border ${HEADER_CELL_CLASS}`}>
          {columnLabel(t('editor.alignment.targetColumn', '번역문'), targetLanguage)}
        </div>
        <div className={`w-[120px] shrink-0 pl-[14px] border-l border-editor-border ${HEADER_CELL_CLASS}`}>
          {t('editor.alignment.alignColumn', '정렬')}
        </div>
      </div>

      {/* 행 목록 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {pairs.length === 0 ? (
          <div className="px-[18px] py-6 text-sm text-editor-muted">
            {t('editor.alignment.empty', '정렬할 문단이 없습니다.')}
          </div>
        ) : (
          pairs.map(({ op, number }) => {
            if (op.kind !== 'pair') return null;
            const unitId = op.target.id ?? null;
            return (
              <AlignmentRow
                key={`${number}-${unitId ?? op.target.path.join('.')}`}
                index={number}
                source={op.source}
                target={op.target}
                active={unitId !== null && unitId === activeAlignmentUnitId}
                onSelect={() => setActiveAlignmentUnitId(unitId)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
