/**
 * 품질 장부 공유 데이터 계약 (설계서 §4).
 *
 * 이 파일의 필드명과 값 어휘는 두 리포(translation-editor, trans_agent)가 합의한
 * 인터페이스다. 코드가 바뀌어도 유지하며, 확장은 optional 필드 추가로만 한다.
 * 기존 필드의 의미 변경·삭제는 설계서 개정 없이 금지.
 */

// ============================================
// 어휘 (Vocabulary)
// ============================================

/** 통합 오류 유형 (§4.2). `대분류.소분류` 형식. */
export type UnifiedFindingType =
  | 'accuracy.omission'
  | 'accuracy.addition'
  | 'accuracy.mistranslation'
  | 'accuracy.nuance'
  | 'fluency.collocation'
  | 'fluency.wording'
  | 'fluency.structure'
  | 'fluency.grammar'
  | 'fluency.repetition'
  | 'fluency.verbosity'
  | 'fluency.weak_ending'
  | 'terminology.violation'
  | 'terminology.inconsistency'
  | 'consistency.phrase'
  | 'source.error'
  | 'source.ambiguity';

/** 심각도 (§4.3). 정본 어휘. */
export type QualitySeverity = 'critical' | 'major' | 'minor';

/** 스테이지: 이 문제가 "발생"했다고 판단되는 지점 (§4.1 origin.stage). */
export type QualityStage =
  | 's0_preflight'
  | 's1_translate'
  | 's2_polish'
  | 's3_verify'
  | 's4_consistency'
  | 'manual_edit';

/** 검출 지점 (§4.1 origin.caught_by). */
export type QualityCaughtBy =
  | 's3_verify'
  | 's4_consistency'
  | 'mono_review'
  | 'review_agent'
  | 'human'
  | 'script';

/** 문제를 만든 실행자 (§4.1 origin.executor). */
export type QualityExecutor = 'app' | 'claude_agent' | 'human';

/** 지적이 워크플로우에서 어떻게 처리됐나 (§4.1 disposition). */
export type QualityDisposition = 'proposed' | 'accepted' | 'rejected' | 'superseded';

/** 규칙 승격 상태 (§4.1 promotion.status). */
export type QualityPromotionStatus = 'candidate' | 'promoted' | 'rejected' | 'not_applicable';

/** 번역 방향 (§4.1 direction). nullable. */
export type QualityDirection = 'ko_to_en' | 'en_to_ko';

// ============================================
// 품질 레코드 (§4.1)
// ============================================

/** 텍스트 삼중항 + 문맥. corrected가 있어야 few-shot 재료가 된다. */
export interface QualitySegment {
  /** 원문 구절. 누락·오역 기록의 전제. fluency 단독 지적은 null 허용. */
  source: string | null;
  /** 문제가 된 번역. */
  output: string;
  /** 확정 수정본. 반려된 지적은 없을 수 있음. */
  corrected: string | null;
  /** 판단에 필요한 최소 주변 문맥. */
  context: string | null;
}

/** 지적 내용 (§4.1 finding). */
export interface QualityFinding {
  type: UnifiedFindingType;
  severity: QualitySeverity;
  /** 왜 문제인지 한 줄. */
  description: string;
  /** 제안된 수정. nullable. */
  suggested_fix: string | null;
}

/** 출처: 파이프라인 계측의 핵심 (§4.1 origin). */
export interface QualityOrigin {
  stage: QualityStage;
  caught_by: QualityCaughtBy | null;
  executor: QualityExecutor;
  producer_model: string | null;
  reviewer_model: string | null;
}

/** 규칙 승격 루프 (§4.1 promotion). trans_agent 마이닝이 사용. */
export interface QualityPromotion {
  status: QualityPromotionStatus;
  /** 기존 룰 재발이면 룰 id, 아니면 null. */
  matched_rule: string | null;
}

/**
 * 품질 레코드: 파이프라인이 만든 "지적·수정·판정" 하나 (§4.1).
 * id·created_at은 앱(장부)이 발급하므로 입력 시점에는 생략한다(QualityRecordInput).
 */
export interface QualityRecord {
  id: string;
  project_id: string;
  created_at: number;

  // 작업 맥락 (nullable)
  doc_ref: string | null;
  route_id: string | null;
  direction: QualityDirection | null;
  content_type: string | null;

  segment: QualitySegment;
  finding: QualityFinding;
  origin: QualityOrigin;
  disposition: QualityDisposition;
  promotion: QualityPromotion;
}

/** 장부에 push할 때의 입력 형태. id·created_at·project_id는 로거가 채운다. */
export type QualityRecordInput = Omit<QualityRecord, 'id' | 'created_at' | 'project_id'> &
  Partial<Pick<QualityRecord, 'id' | 'created_at' | 'project_id'>>;

// ============================================
// 작업 기록 (§4.4)
// ============================================

/** 스테이지 실행 1회 = 1행. 레코드의 분모 (§4.4). */
export interface QualityRun {
  id: string;
  project_id: string;
  started_at: number;
  stage: QualityStage;
  executor: QualityExecutor;
  model: string | null;
  direction: QualityDirection | null;
  route_id: string | null;
  /** 대상 텍스트 단어 수 (KPI 분모). */
  doc_words: number | null;
  findings_count: { critical: number; major: number; minor: number } | null;
  notes: string | null;
}

/** 장부에 push할 때의 입력 형태. id·project_id·started_at은 로거가 채운다. */
export type QualityRunInput = Omit<QualityRun, 'id' | 'project_id' | 'started_at'> &
  Partial<Pick<QualityRun, 'id' | 'project_id' | 'started_at'>>;

// ============================================
// Rust 커맨드 계약 (평탄 row, §4.5 하이브리드 저장)
// ============================================

/** log_quality_records/get_quality_records가 주고받는 평탄 row (camelCase serde). */
export interface QualityRecordRow {
  id: string;
  createdAt: number;
  docRef: string | null;
  routeId: string | null;
  direction: string | null;
  contentType: string | null;
  stage: string | null;
  caughtBy: string | null;
  executor: string | null;
  producerModel: string | null;
  reviewerModel: string | null;
  findingType: string | null;
  severity: string | null;
  disposition: string | null;
  promotionStatus: string | null;
  matchedRule: string | null;
  segmentJson: string | null;
  findingJson: string | null;
  originJson: string | null;
}

/** log_quality_run/load_quality_runs가 주고받는 평탄 row (camelCase serde). */
export interface QualityRunRow {
  id: string;
  startedAt: number;
  stage: string;
  executor: string | null;
  model: string | null;
  direction: string | null;
  routeId: string | null;
  docWords: number | null;
  findingsCountJson: string | null;
  notes: string | null;
}

/** get_quality_records 필터 (§4.7 #2). */
export interface QualityRecordFilter {
  since?: number;
  stage?: string;
  disposition?: string;
  promotionStatus?: string;
  limit?: number;
}
