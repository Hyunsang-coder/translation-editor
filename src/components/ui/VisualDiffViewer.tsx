import { useMemo, useState } from 'react';
import { computeSideBySideDiff, SideBySideRow, DiffPart } from '@/utils/diff';

interface VisualDiffViewerProps {
  original: string;
  suggested: string;
  className?: string;
  onAccept?: () => void;
  onReject?: () => void;
  acceptLabel?: string;
  rejectLabel?: string;
}

type ViewMode = 'side-by-side' | 'unified';

export function VisualDiffViewer({
  original,
  suggested,
  className = '',
  onAccept,
  onReject,
  acceptLabel = '적용하기',
  rejectLabel = '초기화',
}: VisualDiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  // Diff 계산 (줄 단위 + 내부 단어 단위)
  const rows = useMemo(() => computeSideBySideDiff(original, suggested), [original, suggested]);

  // 변경 사항 통계
  const stats = useMemo(() => {
    let added = 0;
    let deleted = 0;
    rows.forEach(row => {
      if (row.changed.type === 'insert') added++;
      if (row.original.type === 'delete') deleted++;
      if (row.original.type === 'modify') {
        // modify인 경우 내부 part를 세거나 그냥 줄 단위로 1개씩 셈
        added++;
        deleted++;
      }
    });
    return { added, deleted };
  }, [rows]);

  return (
    <div className={`flex flex-col h-full bg-editor-bg border border-editor-border rounded-lg overflow-hidden ${className}`}>
      
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border bg-gray-50 dark:bg-gray-800/50 shrink-0">
        <div className="flex items-center gap-6 text-sm w-full">
          <div className="font-semibold text-editor-text min-w-[100px]">
            {stats.added + stats.deleted} changes:
          </div>
          <div className="flex-1 flex justify-between text-editor-muted">
            <span>{stats.added} additions</span>
            <span>&</span>
            <span>{stats.deleted} deletions</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={() => setViewMode(m => m === 'side-by-side' ? 'unified' : 'side-by-side')}
            className="px-3 py-1.5 text-xs font-medium border border-editor-border rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors whitespace-nowrap shadow-sm"
          >
            {viewMode === 'side-by-side' ? '같이 보기' : '양옆에 배치'}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-editor-bg font-mono text-sm leading-6">
        {viewMode === 'side-by-side' ? (
          <SideBySideView rows={rows} />
        ) : (
          <UnifiedView rows={rows} />
        )}
      </div>

      {/* Footer / Actions */}
      {(onAccept || onReject) && (
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-editor-border bg-editor-surface shrink-0">
           {onReject && (
              <button
                onClick={onReject}
                className="px-4 py-2 rounded-md text-sm font-medium border border-editor-border hover:bg-editor-border transition-colors"
              >
                {rejectLabel}
              </button>
            )}
            {onAccept && (
              <button
                onClick={onAccept}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors shadow-sm"
              >
                {acceptLabel}
              </button>
            )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------

function SideBySideView({ rows }: { rows: SideBySideRow[] }) {
  return (
    <div className="w-full table border-collapse min-w-full">
       <colgroup>
        <col className="w-[40px] bg-editor-surface/50 border-r border-editor-border" />
        <col className="w-[calc(50%-40px)] border-r border-editor-border" />
        <col className="w-[40px] bg-editor-surface/50 border-r border-editor-border" />
        <col className="w-[calc(50%-40px)]" />
       </colgroup>
       <tbody className="divide-y divide-transparent">
         {rows.map((row, idx) => (
           <tr key={idx} className="group hover:bg-editor-surface/30">
             {/* Left: Original */}
             <LineCell 
               side="left" 
               num={row.original.num} 
               content={row.original.content} 
               type={row.original.type} 
             />
             
             {/* Right: Changed */}
             <LineCell 
               side="right" 
               num={row.changed.num} 
               content={row.changed.content} 
               type={row.changed.type} 
             />
           </tr>
         ))}
       </tbody>
    </div>
  );
}

function UnifiedView({ rows }: { rows: SideBySideRow[] }) {
  // Unified 뷰는 rows를 순회하며 삭제된 것은 빨갛게, 추가된 것은 초록색으로 순차적으로 표시
  // Modify(수정)인 경우, 보통 원문(삭제) -> 변경(추가) 순서로 표시합니다.
  
  return (
    <div className="w-full table border-collapse">
       <colgroup>
        <col className="w-[40px] bg-editor-surface/50 border-r border-editor-border" />
        <col className="w-[40px] bg-editor-surface/50 border-r border-editor-border" />
        <col className="w-auto" />
       </colgroup>
       <tbody>
         {rows.map((row, idx) => {
           const nodes = [];

           // 1. Original (if exists and not equal)
           if (row.original.type !== 'empty' && row.original.type !== 'equal') {
             nodes.push(
               <UnifiedLineRow 
                 key={`${idx}-orig`}
                 numLeft={row.original.num}
                 numRight={null}
                 content={row.original.content}
                 type="delete"
               />
             );
           }
           
           // 2. Changed (if exists and not equal)
           if (row.changed.type !== 'empty' && row.changed.type !== 'equal') {
             nodes.push(
               <UnifiedLineRow 
                 key={`${idx}-chg`}
                 numLeft={null}
                 numRight={row.changed.num}
                 content={row.changed.content}
                 type="insert"
               />
             );
           }

           // 3. Equal (both same)
           if (row.original.type === 'equal') {
             nodes.push(
                <UnifiedLineRow 
                 key={`${idx}-eq`}
                 numLeft={row.original.num}
                 numRight={row.changed.num}
                 content={row.original.content} // == row.changed.content
                 type="equal"
               />
             );
           }
           
           return nodes;
         })}
       </tbody>
    </div>
  );
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function LineCell({ side, num, content, type }: { 
  side: 'left' | 'right'; 
  num: number | null; 
  content: string | DiffPart[]; 
  type: 'equal' | 'delete' | 'insert' | 'modify' | 'empty';
}) {
  const isEmpty = type === 'empty';
  
  // 배경색 결정 (스크린샷 스타일 반영)
  let bgClass = '';
  let numClass = 'text-editor-muted bg-gray-50 dark:bg-gray-800/30'; // 기본 줄번호 배경

  if (type === 'delete') {
    bgClass = 'bg-red-50/50 dark:bg-red-900/10'; // 연한 빨강
  } else if (type === 'insert') {
    bgClass = 'bg-green-50/50 dark:bg-green-900/10'; // 연한 초록
  } else if (type === 'modify') {
    // 스크린샷의 #eff6ff (아주 연한 파랑) 반영
    bgClass = 'bg-[#eff6ff] dark:bg-blue-900/10'; 
  }

  return (
    <>
      {/* Line Number */}
      <td className={`
        text-right px-3 py-1 select-none text-[11px] align-top border-r border-editor-border/50
        ${numClass}
      `}>
        {num || ''}
      </td>
      
      {/* Content */}
      <td className={`
        px-3 py-1 align-top break-all whitespace-pre-wrap text-[13px] leading-6
        ${bgClass}
      `}>
        {!isEmpty && (
          <DiffContentRenderer content={content} type={type} side={side} />
        )}
      </td>
    </>
  );
}

function UnifiedLineRow({ numLeft, numRight, content, type }: {
  numLeft: number | null;
  numRight: number | null;
  content: string | DiffPart[];
  type: 'equal' | 'delete' | 'insert';
}) {
  let bgClass = '';
  if (type === 'delete') bgClass = 'bg-red-50/50 dark:bg-red-900/10';
  if (type === 'insert') bgClass = 'bg-green-50/50 dark:bg-green-900/10';

  return (
    <tr className={bgClass}>
      <td className="text-right px-2 py-1 select-none text-editor-muted text-[11px] align-top bg-gray-50 dark:bg-gray-800/30 border-r border-editor-border/50 w-[40px]">
        {numLeft || ''}
      </td>
      <td className="text-right px-2 py-1 select-none text-editor-muted text-[11px] align-top bg-gray-50 dark:bg-gray-800/30 border-r border-editor-border/50 w-[40px]">
        {numRight || ''}
      </td>
      <td className="px-3 py-1 align-top break-all whitespace-pre-wrap text-[13px] leading-6">
        <DiffContentRenderer content={content} type={type} side={type === 'delete' ? 'left' : 'right'} />
      </td>
    </tr>
  );
}

function DiffContentRenderer({ content, type, side }: { 
  content: string | DiffPart[]; 
  type: string; 
  side: 'left' | 'right';
}) {
  if (typeof content === 'string') {
    return <span>{content}</span>;
  }
  
  return (
    <span>
      {content.map((part, idx) => {
        if (part.type === 'equal') {
          return <span key={idx}>{part.value}</span>;
        }
        
        if (side === 'left') {
          // 원문: 삭제된 부분 하이라이트 (스크린샷: 진한 빨강 배경 + 취소선)
          if (part.type === 'delete') {
            return (
              <span key={idx} className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-100 line-through decoration-red-400 decoration-1 rounded-[2px] px-0.5">
                {part.value}
              </span>
            );
          }
          return null; 
        } else {
          // 변경문: 추가된 부분 하이라이트 (스크린샷: 진한 초록 배경)
          if (part.type === 'insert') {
            return (
              <span key={idx} className="bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-100 rounded-[2px] px-0.5">
                {part.value}
              </span>
            );
          }
          return null;
        }
      })}
    </span>
  );
}
