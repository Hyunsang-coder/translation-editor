/**
 * 리뷰 이슈 ↔ 품질 장부 브리지 (WP-A1 요구사항 2).
 *
 * reviewStore는 메모리 전용(비영속)이므로, 장부 기록은 store 내부가 아니라 리뷰 수명주기
 * 이벤트가 관측되는 호출부에서 이 모듈을 통해 수행한다. 그래야 memory-only 컨벤션을
 * 깨지 않고, race 위험도 없다.
 *
 * disposition 갱신을 위해 레코드 id를 이슈에서 결정론적으로 파생한다
 * (qr_<caughtBy>_<issueId>). 따라서 accept/reject 시 같은 id를 재계산해 갱신할 수 있고,
 * DB의 INSERT OR REPLACE가 재로깅을 멱등하게 만든다. store 리마운트에도 안전하다.
 */

import type { ReviewIssue } from '@/stores/reviewStore';
import { getAiConfig } from '@/ai/config';
import type {
  QualityCaughtBy,
  QualityDirection,
  QualityRecordInput,
  QualityStage,
} from './types';
import { normalizeSeverity, toUnifiedFindingType } from './vocabulary';
import { logQualityRecords, updateQualityDisposition } from './ledger';

/** 리뷰 이슈가 어느 파이프라인 맥락에서 잡혔는지 (origin 채우기용). */
export interface ReviewLedgerContext {
  /** 이 문제가 "발생"한 스테이지. 앱 대조 리뷰가 잡은 것은 대개 s1_translate의 산물이다. */
  stage: QualityStage;
  /** 누가 잡았나. app 리뷰=review_agent, 외부 에이전트=review_agent, S3 검증=s3_verify 등. */
  caughtBy: QualityCaughtBy;
  /** 문제를 만든 실행자. app 번역이면 app, 외부 에이전트 반입이면 claude_agent. */
  executor: 'app' | 'claude_agent';
  direction: QualityDirection | null;
  contentType: string | null;
  /** 검증에 쓰인 모델(app 리뷰면 리뷰 모델). */
  reviewerModel: string | null;
  /** 문제 번역을 생성한 모델(알 수 있으면). */
  producerModel: string | null;
}

/** 앱 내부 대조 리뷰의 기본 맥락. 프로젝트 정보로 direction/contentType만 채운다. */
export function appReviewContext(params: {
  direction?: QualityDirection | null;
  contentType?: string | null;
}): ReviewLedgerContext {
  let reviewerModel: string | null = null;
  try {
    reviewerModel = getAiConfig({ useFor: 'review' }).model ?? null;
  } catch {
    reviewerModel = null;
  }
  return {
    stage: 's1_translate',
    caughtBy: 'review_agent',
    executor: 'app',
    direction: params.direction ?? null,
    contentType: params.contentType ?? null,
    reviewerModel,
    producerModel: null,
  };
}

/** 레코드 id를 이슈에서 결정론적으로 파생 (disposition 갱신 재타겟팅용). */
export function ledgerIdForIssue(issue: ReviewIssue, caughtBy: QualityCaughtBy): string {
  return `qr_${caughtBy}_${issue.id}`;
}

/** ReviewIssue → QualityRecordInput 변환. */
function issueToRecord(
  issue: ReviewIssue,
  ctx: ReviewLedgerContext,
  disposition: QualityRecordInput['disposition'],
  corrected: string | null,
): QualityRecordInput {
  return {
    id: ledgerIdForIssue(issue, ctx.caughtBy),
    doc_ref: null,
    route_id: null,
    direction: ctx.direction,
    content_type: ctx.contentType,
    segment: {
      source: issue.sourceExcerpt || null,
      output: issue.targetExcerpt,
      corrected,
      context: null,
    },
    finding: {
      type: toUnifiedFindingType(issue.type),
      severity: normalizeSeverity(issue.severity),
      description: issue.description,
      suggested_fix: issue.suggestedFix || null,
    },
    origin: {
      stage: ctx.stage,
      caught_by: ctx.caughtBy,
      executor: ctx.executor,
      producer_model: ctx.producerModel,
      reviewer_model: ctx.reviewerModel,
    },
    disposition,
    promotion: { status: 'candidate', matched_rule: null },
  };
}

/**
 * 리뷰가 이슈를 생성했을 때(proposed) 장부에 적재한다 (WP-A1 요구사항 2-①/④).
 * best-effort. 외부 반입(executor=claude_agent)도 이 경로를 쓴다.
 */
export async function recordIssuesProposed(
  projectId: string,
  issues: ReviewIssue[],
  ctx: ReviewLedgerContext,
): Promise<void> {
  if (!projectId || issues.length === 0) return;
  const records = issues.map((it) => issueToRecord(it, ctx, 'proposed', null));
  await logQualityRecords(projectId, records);
}

/**
 * 이슈의 수정이 문서에 적용됐을 때(accepted) disposition을 갱신한다 (WP-A1 요구사항 2-②).
 * corrected 텍스트를 채워 few-shot 재료로 남긴다. 갱신 시도가 0건이면(=proposed 기록이
 * 아직 없으면) 그 이슈를 accepted로 새로 적재한다.
 */
export async function recordIssueAccepted(
  projectId: string,
  issue: ReviewIssue,
  ctx: ReviewLedgerContext,
  appliedText: string,
): Promise<void> {
  if (!projectId) return;
  const id = ledgerIdForIssue(issue, ctx.caughtBy);
  const updated = await updateQualityDisposition(projectId, [id], 'accepted');
  if (updated === 0) {
    // proposed가 아직 안 실린 경우(예: 기록 순서 역전) accepted로 직접 적재
    await logQualityRecords(projectId, [issueToRecord(issue, ctx, 'accepted', appliedText)]);
  }
}

/**
 * 처리되지 않고 검수 세션이 종료·초기화될 때(rejected) 남은 이슈들의 disposition을 갱신한다
 * (WP-A1 요구사항 2-③, "무시"도 판정이다).
 */
export async function recordIssuesRejected(
  projectId: string,
  issues: ReviewIssue[],
  ctx: ReviewLedgerContext,
): Promise<void> {
  if (!projectId || issues.length === 0) return;
  const ids = issues.map((it) => ledgerIdForIssue(it, ctx.caughtBy));
  const updated = await updateQualityDisposition(projectId, ids, 'rejected');
  // proposed 기록이 없던 이슈는 rejected로 새로 적재 (over-capture 허용, §7.4)
  if (updated < ids.length) {
    const records = issues.map((it) => issueToRecord(it, ctx, 'rejected', null));
    await logQualityRecords(projectId, records);
  }
}
