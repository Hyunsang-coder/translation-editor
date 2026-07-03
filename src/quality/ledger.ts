/**
 * 품질 장부 로거 (설계서 §4.5 / WP-A1).
 *
 * 파이프라인의 모든 지적·수정·판정을 SQLite에 영속화한다. 핵심 계약:
 * - 장부 기록은 파이프라인의 **부산물**이며 best-effort다. 기록 실패가 번역·리뷰 UX를
 *   막지 않는다(WP-A1 요구사항 5). 모든 실패는 삼켜서 console.warn만 남긴다.
 * - id·created_at은 앱(여기)이 발급한다(§4.1).
 * - 저장은 하이브리드(§4.5): KPI 필드는 평탄 컬럼, 나머지 중첩 객체는 JSON blob으로.
 */

import { v4 as uuidv4 } from 'uuid';
import { invoke, isTauriRuntime } from '@/tauri/invoke';
import { pickQualityLedgerPath } from '@/tauri/dialog';
import type {
  QualityRecord,
  QualityRecordFilter,
  QualityRecordInput,
  QualityRecordRow,
  QualityRun,
  QualityRunInput,
  QualityRunRow,
} from './types';

const now = (): number => Date.now();

/**
 * 단어 수 계산 (§4.4 doc_words, KPI 분모).
 * CJK는 공백 분절이 없으므로 CJK 문자 1자 = 1단어로, 라틴/기타는 공백 분절로 센다.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  const nonCjk = text.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ');
  const latinWords = nonCjk.split(/\s+/).filter((w) => /\S/.test(w)).length;
  return cjk + latinWords;
}

// ============================================
// 레코드 ↔ 평탄 row 변환 (하이브리드 저장, §4.5)
// ============================================

function recordToRow(rec: QualityRecord): QualityRecordRow {
  return {
    id: rec.id,
    createdAt: rec.created_at,
    docRef: rec.doc_ref,
    routeId: rec.route_id,
    direction: rec.direction,
    contentType: rec.content_type,
    // origin/finding/promotion에서 KPI 컬럼으로 승격
    stage: rec.origin.stage,
    caughtBy: rec.origin.caught_by,
    executor: rec.origin.executor,
    producerModel: rec.origin.producer_model,
    reviewerModel: rec.origin.reviewer_model,
    findingType: rec.finding.type,
    severity: rec.finding.severity,
    disposition: rec.disposition,
    promotionStatus: rec.promotion.status,
    matchedRule: rec.promotion.matched_rule,
    // 상세는 JSON blob
    segmentJson: JSON.stringify(rec.segment),
    findingJson: JSON.stringify(rec.finding),
    originJson: JSON.stringify(rec.origin),
  };
}

/** 평탄 row → 레코드 (조회 시 blob을 파싱해 복원). */
export function rowToRecord(row: QualityRecordRow, projectId: string): QualityRecord {
  const segment: QualityRecord['segment'] = safeParse<QualityRecord['segment']>(row.segmentJson) ?? {
    source: null,
    output: '',
    corrected: null,
    context: null,
  };
  const finding: QualityRecord['finding'] = safeParse<QualityRecord['finding']>(row.findingJson) ?? {
    type: (row.findingType as QualityRecord['finding']['type']) ?? 'fluency.wording',
    severity: (row.severity as QualityRecord['finding']['severity']) ?? 'major',
    description: '',
    suggested_fix: null,
  };
  const origin: QualityRecord['origin'] = safeParse<QualityRecord['origin']>(row.originJson) ?? {
    stage: (row.stage as QualityRecord['origin']['stage']) ?? 'manual_edit',
    caught_by: (row.caughtBy as QualityRecord['origin']['caught_by']) ?? null,
    executor: (row.executor as QualityRecord['origin']['executor']) ?? 'app',
    producer_model: row.producerModel ?? null,
    reviewer_model: row.reviewerModel ?? null,
  };
  return {
    id: row.id,
    project_id: projectId,
    created_at: row.createdAt,
    doc_ref: row.docRef,
    route_id: row.routeId,
    direction: (row.direction as QualityRecord['direction']) ?? null,
    content_type: row.contentType,
    segment,
    finding,
    origin,
    disposition: (row.disposition as QualityRecord['disposition']) ?? 'proposed',
    promotion: {
      status: (row.promotionStatus as QualityRecord['promotion']['status']) ?? 'not_applicable',
      matched_rule: row.matchedRule,
    },
  };
}

function runToRow(run: QualityRun): QualityRunRow {
  return {
    id: run.id,
    startedAt: run.started_at,
    stage: run.stage,
    executor: run.executor,
    model: run.model,
    direction: run.direction,
    routeId: run.route_id,
    docWords: run.doc_words,
    findingsCountJson: run.findings_count ? JSON.stringify(run.findings_count) : null,
    notes: run.notes,
  };
}

function safeParse<T = unknown>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// ============================================
// 입력 정규화 (id·created_at·project_id 발급)
// ============================================

function fillRecordDefaults(input: QualityRecordInput, projectId: string): QualityRecord {
  return {
    id: input.id ?? `qr_${uuidv4()}`,
    project_id: input.project_id ?? projectId,
    created_at: input.created_at ?? now(),
    doc_ref: input.doc_ref ?? null,
    route_id: input.route_id ?? null,
    direction: input.direction ?? null,
    content_type: input.content_type ?? null,
    segment: input.segment,
    finding: input.finding,
    origin: input.origin,
    disposition: input.disposition,
    promotion: input.promotion,
  };
}

function fillRunDefaults(input: QualityRunInput, projectId: string): QualityRun {
  return {
    id: input.id ?? `run_${uuidv4()}`,
    project_id: input.project_id ?? projectId,
    started_at: input.started_at ?? now(),
    stage: input.stage,
    executor: input.executor,
    model: input.model ?? null,
    direction: input.direction ?? null,
    route_id: input.route_id ?? null,
    doc_words: input.doc_words ?? null,
    findings_count: input.findings_count ?? null,
    notes: input.notes ?? null,
  };
}

// ============================================
// Best-effort 로깅 API
// ============================================

/**
 * 품질 레코드를 장부에 append 한다. best-effort — 실패해도 throw하지 않는다.
 * 발급된 레코드(id·created_at 채워진)를 반환하며, 저장 실패 시 빈 배열.
 */
export async function logQualityRecords(
  projectId: string,
  inputs: QualityRecordInput[],
): Promise<QualityRecord[]> {
  if (!projectId || inputs.length === 0) return [];
  const records = inputs.map((i) => fillRecordDefaults(i, projectId));
  if (!isTauriRuntime()) {
    // 비-Tauri(웹 테스트 등)에서는 발급만 하고 영속화는 생략
    return records;
  }
  try {
    await invoke<number>('log_quality_records', {
      args: { projectId, records: records.map(recordToRow) },
    });
    return records;
  } catch (err) {
    console.warn('[quality-ledger] logQualityRecords failed (best-effort):', err);
    return [];
  }
}

/** 단일 레코드 편의 래퍼. */
export async function logQualityRecord(
  projectId: string,
  input: QualityRecordInput,
): Promise<QualityRecord | null> {
  const [rec] = await logQualityRecords(projectId, [input]);
  return rec ?? null;
}

/** 작업 기록(quality_run)을 저장한다. best-effort. */
export async function logQualityRun(
  projectId: string,
  input: QualityRunInput,
): Promise<QualityRun | null> {
  if (!projectId) return null;
  const run = fillRunDefaults(input, projectId);
  if (!isTauriRuntime()) return run;
  try {
    await invoke<void>('log_quality_run', { args: { projectId, run: runToRow(run) } });
    return run;
  } catch (err) {
    console.warn('[quality-ledger] logQualityRun failed (best-effort):', err);
    return null;
  }
}

/**
 * 레코드들의 disposition을 갱신한다 (proposed → accepted/rejected/superseded).
 * best-effort. 갱신된 행 수를 반환(실패 시 0).
 */
export async function updateQualityDisposition(
  projectId: string,
  ids: string[],
  disposition: QualityRecord['disposition'],
): Promise<number> {
  if (!projectId || ids.length === 0) return 0;
  if (!isTauriRuntime()) return 0;
  try {
    return await invoke<number>('update_quality_disposition', {
      args: { projectId, ids, disposition },
    });
  } catch (err) {
    console.warn('[quality-ledger] updateQualityDisposition failed (best-effort):', err);
    return 0;
  }
}

/** 필터로 레코드를 조회한다 (§4.7 #2). 실패 시 빈 배열. */
export async function getQualityRecords(
  projectId: string,
  filter: QualityRecordFilter = {},
): Promise<QualityRecord[]> {
  if (!projectId || !isTauriRuntime()) return [];
  try {
    const rows = await invoke<QualityRecordRow[]>('get_quality_records', {
      args: { projectId, filter },
    });
    return rows.map((r) => rowToRecord(r, projectId));
  } catch (err) {
    console.warn('[quality-ledger] getQualityRecords failed:', err);
    return [];
  }
}

/** 프로젝트의 작업 기록 전체를 조회한다. 실패 시 빈 배열. */
export async function loadQualityRuns(projectId: string): Promise<QualityRun[]> {
  if (!projectId || !isTauriRuntime()) return [];
  try {
    const rows = await invoke<QualityRunRow[]>('load_quality_runs', { args: { projectId } });
    return rows.map((row) => ({
      id: row.id,
      project_id: projectId,
      started_at: row.startedAt,
      stage: row.stage as QualityRun['stage'],
      executor: (row.executor as QualityRun['executor']) ?? 'app',
      model: row.model,
      direction: (row.direction as QualityRun['direction']) ?? null,
      route_id: row.routeId,
      doc_words: row.docWords,
      findings_count: safeParse(row.findingsCountJson),
      notes: row.notes,
    }));
  } catch (err) {
    console.warn('[quality-ledger] loadQualityRuns failed:', err);
    return [];
  }
}

// ============================================
// JSONL export (WP-A1 요구사항 4)
// ============================================

/**
 * 프로젝트의 레코드+런을 JSONL 문자열로 직렬화한다 (줄당 1 객체, §4.5 교환 포맷).
 * 레코드와 런을 한 스트림에 담되 `_kind`로 구분한다.
 */
export async function exportQualityJsonl(projectId: string): Promise<string> {
  const [records, runs] = await Promise.all([
    getQualityRecords(projectId, { limit: 100000 }),
    loadQualityRuns(projectId),
  ]);
  const lines: string[] = [];
  for (const run of runs) {
    lines.push(JSON.stringify({ _kind: 'quality_run', ...run }));
  }
  for (const rec of records) {
    lines.push(JSON.stringify({ _kind: 'quality_record', ...rec }));
  }
  return lines.join('\n');
}

/**
 * 품질 장부를 JSONL 파일로 저장한다 (WP-A1 요구사항 4).
 * Tauri에서는 저장 다이얼로그 + write_text_file, 웹에서는 blob 다운로드.
 * 결과: 'saved' | 'cancelled' | 'empty'.
 */
export async function saveQualityJsonl(
  projectId: string,
  defaultName = 'quality-ledger',
): Promise<'saved' | 'cancelled' | 'empty'> {
  const jsonl = await exportQualityJsonl(projectId);
  if (!jsonl) return 'empty';

  if (isTauriRuntime()) {
    const path = await pickQualityLedgerPath(defaultName);
    if (!path) return 'cancelled';
    await invoke<void>('write_text_file', { path, content: jsonl });
    return 'saved';
  }

  // 웹 fallback: blob 다운로드
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
