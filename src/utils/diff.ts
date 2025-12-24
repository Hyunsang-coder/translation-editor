/**
 * Diff 유틸리티
 * 'diff' 패키지를 사용하여 텍스트 비교 및 변경 사항 계산
 */

import * as Diff from 'diff';
import type { DiffChange, DiffResult } from '@/types';

/**
 * 기본 문자 단위 Diff (호환성 유지용)
 */
export function calculateDiff(original: string, suggested: string): DiffChange[] {
  const diffs = Diff.diffChars(original, suggested);
  let position = 0;

  return diffs.map((part) => {
    const change: DiffChange = {
      type: part.added ? 'insert' : part.removed ? 'delete' : 'equal',
      value: part.value,
      start: position,
      end: position + part.value.length,
    };

    // 원문 기준 위치 이동 (삭제된 부분은 원문에 있었으므로 포함, 추가된 부분은 원문에 없었으므로 제외해야 하지만
    // 기존 로직과 호환성을 위해 체크 필요. 보통 원문 인덱스는 equal/delete만 카운트)
    if (!part.added) {
      position += part.value.length;
    }
    
    return change;
  });
}

export function createDiffResult(
  blockId: string,
  original: string,
  suggested: string
): DiffResult {
  return {
    blockId,
    original,
    suggested,
    changes: calculateDiff(original, suggested),
    status: 'pending',
  };
}

/**
 * Diff 적용 후 최종 텍스트 계산 (수락 시)
 */
export function applyDiff(changes: DiffChange[]): string {
  return changes
    .filter((change) => change.type !== 'delete')
    .map((change) => change.value)
    .join('');
}

/**
 * Diff 거부 후 원본 텍스트 복원
 */
export function revertDiff(changes: DiffChange[]): string {
  return changes
    .filter((change) => change.type !== 'insert')
    .map((change) => change.value)
    .join('');
}

/**
 * 단순 HTML 변환 (Legacy)
 */
export function diffToHtml(changes: DiffChange[]): string {
  return changes
    .map((change) => {
      switch (change.type) {
        case 'insert':
          return `<span data-diff-insertion class="diff-insertion">${escapeHtml(change.value)}</span>`;
        case 'delete':
          return `<span data-diff-deletion class="diff-deletion">${escapeHtml(change.value)}</span>`;
        default:
          return escapeHtml(change.value);
      }
    })
    .join('');
}

export function diffToOriginalHtml(changes: DiffChange[]): string {
  return changes
    .map((change) => {
      switch (change.type) {
        case 'delete':
          return `<span data-diff-deletion class="diff-deletion">${escapeHtml(change.value)}</span>`;
        case 'insert':
          return '';
        default:
          return escapeHtml(change.value);
      }
    })
    .join('');
}

export function diffToSuggestedHtml(changes: DiffChange[]): string {
  return changes
    .map((change) => {
      switch (change.type) {
        case 'insert':
          return `<span data-diff-insertion class="diff-insertion">${escapeHtml(change.value)}</span>`;
        case 'delete':
          return '';
        default:
          return escapeHtml(change.value);
      }
    })
    .join('');
}

// ==========================================
// Advanced Diff Logic (Line & Word) - Using 'diff' package
// ==========================================

export interface DiffPart {
  type: 'equal' | 'insert' | 'delete';
  value: string;
}

export interface SideBySideRow {
  original: {
    num: number | null;
    content: string | DiffPart[]; // string(equal/delete) or parts(modify)
    type: 'equal' | 'delete' | 'modify' | 'empty';
  };
  changed: {
    num: number | null;
    content: string | DiffPart[];
    type: 'equal' | 'insert' | 'modify' | 'empty';
  };
}

/**
 * Side-by-Side 뷰를 위한 하이브리드 Diff 계산
 * (줄 단위 매칭 후 변경된 줄은 단어 단위 비교)
 */
export function computeSideBySideDiff(text1: string, text2: string): SideBySideRow[] {
  // 1. 줄 단위 Diff (newlineIsToken: true로 하면 줄바꿈도 토큰으로 처리됨)
  // 여기서는 일반적인 diffLines 사용
  const lineDiffs = Diff.diffLines(text1, text2);
  const rows: SideBySideRow[] = [];

  let lineNum1 = 1;
  let lineNum2 = 1;
  
  // 줄 단위 Diff 결과에는 개행문자가 포함되어 있으므로 분리해서 처리
  const processDiffPart = (part: Diff.Change) => {
    // 마지막 줄바꿈 처리가 까다로울 수 있음. 
    // 단순하게 split('\n') 하면 마지막 빈 문자열이 생길 수 있음.
    let lines = part.value.split('\n');
    // 마지막이 빈 문자열이면 제거 (단, 원래 텍스트가 빈 줄로 끝나는 경우 등 고려 필요)
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    
    return lines;
  };

  // 버퍼는 줄 단위 문자열 배열로 관리
  let pendingDeletes: string[] = [];
  let pendingInserts: string[] = [];

  const flushStringBuffers = () => {
    const maxLen = Math.max(pendingDeletes.length, pendingInserts.length);
    for(let i=0; i<maxLen; i++) {
        const del = pendingDeletes[i];
        const ins = pendingInserts[i];
        
        if (del !== undefined && ins !== undefined) {
            // Modified
            const wordDiffs = Diff.diffWords(del, ins);
            const parts: DiffPart[] = wordDiffs.map(p => ({
                type: p.added ? 'insert' : p.removed ? 'delete' : 'equal',
                value: p.value
            }));
            rows.push({
                original: { num: lineNum1++, content: parts, type: 'modify' },
                changed: { num: lineNum2++, content: parts, type: 'modify' }
            });
        } else if (del !== undefined) {
            rows.push({
                original: { num: lineNum1++, content: del, type: 'delete' },
                changed: { num: null, content: '', type: 'empty' }
            });
        } else if (ins !== undefined) {
            rows.push({
                original: { num: null, content: '', type: 'empty' },
                changed: { num: lineNum2++, content: ins, type: 'insert' }
            });
        }
    }
    pendingDeletes = [];
    pendingInserts = [];
  };

  for (const part of lineDiffs) {
    const lines = processDiffPart(part);
    
    if (part.added) {
        pendingInserts.push(...lines);
    } else if (part.removed) {
        pendingDeletes.push(...lines);
    } else {
        // Equal - 먼저 pending된 변경사항들 처리
        flushStringBuffers();
        
        // Equal 라인들 추가
        for (const line of lines) {
            rows.push({
                original: { num: lineNum1++, content: line, type: 'equal' },
                changed: { num: lineNum2++, content: line, type: 'equal' }
            });
        }
    }
  }
  
  // 남은 버퍼 처리
  flushStringBuffers();
  
  return rows;
}

function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
}
