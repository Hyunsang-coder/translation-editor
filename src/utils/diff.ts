/**
 * Diff 유틸리티
 * 텍스트 비교 및 변경 사항 계산
 */

import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch';
import type { DiffChange, DiffResult } from '@/types';

const dmp = new diff_match_patch();

/**
 * 두 텍스트 간의 차이점 계산
 * @param original - 원본 텍스트
 * @param suggested - 제안된 텍스트
 * @returns 변경 사항 배열
 */
export function calculateDiff(original: string, suggested: string): DiffChange[] {
  const diffs = dmp.diff_main(original, suggested);
  dmp.diff_cleanupSemantic(diffs);

  const changes: DiffChange[] = [];
  let position = 0;

  for (const [operation, text] of diffs) {
    const change: DiffChange = {
      type: operation === DIFF_INSERT ? 'insert' : operation === DIFF_DELETE ? 'delete' : 'equal',
      value: text,
      start: position,
      end: position + text.length,
    };

    changes.push(change);

    // 삭제된 텍스트는 위치를 이동하지 않음
    if (operation !== DIFF_DELETE) {
      position += text.length;
    }
  }

  return changes;
}

/**
 * Diff 결과 생성
 * @param blockId - 블록 ID
 * @param original - 원본 텍스트
 * @param suggested - 제안된 텍스트
 * @returns Diff 결과 객체
 */
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
 * Diff 변경 사항을 HTML로 변환
 * @param changes - 변경 사항 배열
 * @returns HTML 문자열
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

/**
 * HTML 특수 문자 이스케이프
 * @param text - 원본 텍스트
 * @returns 이스케이프된 텍스트
 */
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

/**
 * Diff 적용 후 최종 텍스트 계산 (수락 시)
 * @param changes - 변경 사항 배열
 * @returns 최종 텍스트
 */
export function applyDiff(changes: DiffChange[]): string {
  return changes
    .filter((change) => change.type !== 'delete')
    .map((change) => change.value)
    .join('');
}

/**
 * Diff 거부 후 원본 텍스트 복원
 * @param changes - 변경 사항 배열
 * @returns 원본 텍스트
 */
export function revertDiff(changes: DiffChange[]): string {
  return changes
    .filter((change) => change.type !== 'insert')
    .map((change) => change.value)
    .join('');
}

