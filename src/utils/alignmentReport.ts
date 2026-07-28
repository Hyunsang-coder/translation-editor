import { invoke, isTauriRuntime } from '@/tauri/invoke';
import { pickQualityLedgerPath } from '@/tauri/dialog';
import type { AlignResult } from '@/utils/alignUnits';

/**
 * 정렬 검사 결과 한 줄 (JSONL).
 *
 * Phase 5(영속 정렬 레이어, 4–6주)를 착수할지 판단하는 근거다. 여러 프로젝트에서
 * `ratio`가 꾸준히 0.95 이상이면 영속 정렬은 필요 없고, 0.7 근처로 떨어지면 해야 한다.
 * **자동 수집은 하지 않는다** — 사용자가 버튼을 눌러 내보낼 때만 만든다.
 */
export interface AlignmentReport {
  kind: 'alignment_check';
  project_id: string;
  at: string;
  total_units: number;
  paired: number;
  mismatched: number;
  ratio: number;
  unmapped_issues: number;
  degraded: boolean;
}

export function buildAlignmentReport(
  projectId: string,
  result: AlignResult,
  unmappedIssues: number,
  at: Date = new Date(),
): AlignmentReport {
  return {
    kind: 'alignment_check',
    project_id: projectId,
    at: at.toISOString(),
    total_units: result.totalUnits,
    paired: result.pairedCount,
    mismatched: result.mismatchCount,
    ratio: Math.round(result.ratio * 1000) / 1000,
    unmapped_issues: unmappedIssues,
    degraded: result.degraded,
  };
}

/** `saveQualityJsonl`과 같은 방식 — Tauri에서는 저장 다이얼로그, 웹에서는 blob 다운로드. */
export async function saveAlignmentReport(
  report: AlignmentReport,
  defaultName = 'alignment-check',
): Promise<'saved' | 'cancelled'> {
  const jsonl = `${JSON.stringify(report)}\n`;

  if (isTauriRuntime()) {
    const path = await pickQualityLedgerPath(defaultName);
    if (!path) return 'cancelled';
    await invoke<void>('write_text_file', { path, content: jsonl });
    return 'saved';
  }

  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${defaultName}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'saved';
}
