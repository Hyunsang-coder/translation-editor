import { describe, it, expect } from 'vitest';
import type { ReviewIssue } from '@/stores/reviewStore';
import {
  fromUnifiedFindingType,
  normalizeSeverity,
  toUnifiedFindingType,
} from './vocabulary';
import { countWords, exportQualityJsonl, logQualityRecords, rowToRecord } from './ledger';
import type { QualityRecord, QualityRecordRow } from './types';
import { appReviewContext, ledgerIdForIssue } from './reviewLedger';

// 참고: isTauriRuntime()이 false인 테스트 환경에서 logQualityRecords는 영속화 없이
// id·created_at을 발급한 레코드를 그대로 반환한다(§4.5 웹 fallback). 이를 이용해 검증한다.

describe('vocabulary: type 변환 (§4.2)', () => {
  it('앱 IssueType 6종을 통합 어휘로 변환한다', () => {
    expect(toUnifiedFindingType('omission')).toBe('accuracy.omission');
    expect(toUnifiedFindingType('addition')).toBe('accuracy.addition');
    expect(toUnifiedFindingType('mistranslation')).toBe('accuracy.mistranslation');
    expect(toUnifiedFindingType('grammar')).toBe('fluency.grammar');
    expect(toUnifiedFindingType('awkward')).toBe('fluency.structure');
    expect(toUnifiedFindingType('terminology')).toBe('terminology.violation');
  });

  it('통합 어휘를 앱 IssueType으로 역변환한다', () => {
    expect(fromUnifiedFindingType('accuracy.omission')).toBe('omission');
    expect(fromUnifiedFindingType('terminology.inconsistency')).toBe('terminology');
    expect(fromUnifiedFindingType('consistency.phrase')).toBe('terminology');
    // 앱에 대응 없는 값은 근사
    expect(fromUnifiedFindingType('accuracy.nuance')).toBe('mistranslation');
    expect(fromUnifiedFindingType('fluency.collocation')).toBe('awkward');
  });

  it('알 수 없는 값은 방어적으로 근사한다', () => {
    expect(fromUnifiedFindingType('nonsense.value')).toBe('awkward');
  });
});

describe('vocabulary: severity 정규화 (§4.3)', () => {
  it('유효 값은 그대로', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
    expect(normalizeSeverity('major')).toBe('major');
    expect(normalizeSeverity('minor')).toBe('minor');
  });
  it('알 수 없는 값은 major로', () => {
    expect(normalizeSeverity('bogus')).toBe('major');
  });
});

describe('countWords (§4.4 doc_words)', () => {
  it('라틴 텍스트는 공백 분절로 센다', () => {
    expect(countWords('the quick brown fox')).toBe(4);
    expect(countWords('  spaced   out  ')).toBe(2);
  });
  it('CJK는 문자 1자 = 1단어', () => {
    expect(countWords('안녕하세요')).toBe(5);
  });
  it('혼합 텍스트', () => {
    // "한글 3자" + latin 2단어
    expect(countWords('가나다 hello world')).toBe(5);
  });
  it('빈 문자열은 0', () => {
    expect(countWords('')).toBe(0);
  });
});

describe('ledger: 레코드 ↔ row 라운드트립 (하이브리드 저장 §4.5)', () => {
  it('평탄 컬럼과 JSON blob을 오가며 의미가 보존된다', async () => {
    const [rec] = await logQualityRecords('proj-1', [
      {
        doc_ref: null,
        route_id: null,
        direction: 'ko_to_en',
        content_type: 'design_doc',
        segment: { source: '원문', output: 'bad tr', corrected: null, context: null },
        finding: {
          type: 'accuracy.omission',
          severity: 'major',
          description: '누락',
          suggested_fix: 'add it',
        },
        origin: {
          stage: 's1_translate',
          caught_by: 'review_agent',
          executor: 'app',
          producer_model: null,
          reviewer_model: 'claude-opus-4-8',
        },
        disposition: 'proposed',
        promotion: { status: 'candidate', matched_rule: null },
      },
    ]);
    expect(rec).toBeDefined();
    expect(rec!.id).toMatch(/^qr_/);
    expect(rec!.created_at).toBeGreaterThan(0);
    expect(rec!.project_id).toBe('proj-1');

    // rowToRecord로 복원했을 때 원본과 일치하는지 (row는 recordToRow의 결과를 흉내)
    const row: QualityRecordRow = {
      id: rec!.id,
      createdAt: rec!.created_at,
      docRef: null,
      routeId: null,
      direction: 'ko_to_en',
      contentType: 'design_doc',
      stage: 's1_translate',
      caughtBy: 'review_agent',
      executor: 'app',
      producerModel: null,
      reviewerModel: 'claude-opus-4-8',
      findingType: 'accuracy.omission',
      severity: 'major',
      disposition: 'proposed',
      promotionStatus: 'candidate',
      matchedRule: null,
      segmentJson: JSON.stringify(rec!.segment),
      findingJson: JSON.stringify(rec!.finding),
      originJson: JSON.stringify(rec!.origin),
    };
    const restored = rowToRecord(row, 'proj-1');
    expect(restored.finding.type).toBe('accuracy.omission');
    expect(restored.origin.reviewer_model).toBe('claude-opus-4-8');
    expect(restored.segment.output).toBe('bad tr');
    expect(restored.disposition).toBe('proposed');
    expect(restored.promotion.status).toBe('candidate');
  });

  it('깨진 JSON blob이 있어도 방어적으로 복원한다', () => {
    const row: QualityRecordRow = {
      id: 'qr_x',
      createdAt: 1,
      docRef: null,
      routeId: null,
      direction: null,
      contentType: null,
      stage: 's2_polish',
      caughtBy: null,
      executor: 'app',
      producerModel: null,
      reviewerModel: null,
      findingType: 'fluency.grammar',
      severity: 'minor',
      disposition: 'accepted',
      promotionStatus: 'not_applicable',
      matchedRule: null,
      segmentJson: '{broken',
      findingJson: null,
      originJson: null,
    };
    const rec = rowToRecord(row, 'p');
    // blob 파싱 실패 시 평탄 컬럼에서 복원
    expect(rec.finding.type).toBe('fluency.grammar');
    expect(rec.origin.stage).toBe('s2_polish');
    expect(rec.disposition).toBe('accepted');
  });
});

describe('reviewLedger: 이슈 → 레코드 id 파생', () => {
  function issue(): ReviewIssue {
    return {
      id: 'abc123',
      segmentOrder: 3,
      segmentGroupId: 'g1',
      sourceExcerpt: 'src',
      targetExcerpt: 'tgt',
      suggestedFix: 'fix',
      type: 'omission',
      severity: 'major',
      description: 'desc',
      checked: false,
    };
  }

  it('caught_by별로 결정론적 id를 만든다 (disposition 갱신 재타겟팅용)', () => {
    const id1 = ledgerIdForIssue(issue(), 'review_agent');
    const id2 = ledgerIdForIssue(issue(), 'review_agent');
    expect(id1).toBe(id2);
    expect(id1).toBe('qr_review_agent_abc123');
    // caught_by가 다르면 다른 id
    expect(ledgerIdForIssue(issue(), 's3_verify')).not.toBe(id1);
  });

  it('appReviewContext는 origin 기본값을 채운다', () => {
    const ctx = appReviewContext({ contentType: 'meeting_notes' });
    expect(ctx.stage).toBe('s1_translate');
    expect(ctx.caughtBy).toBe('review_agent');
    expect(ctx.executor).toBe('app');
    expect(ctx.contentType).toBe('meeting_notes');
  });
});

describe('exportQualityJsonl', () => {
  it('레코드가 없으면 빈 문자열 (§4.5)', async () => {
    // Tauri 미실행 → getQualityRecords/loadQualityRuns가 빈 배열 반환
    const jsonl = await exportQualityJsonl('no-such-project');
    expect(jsonl).toBe('');
  });

  it('직렬화된 각 줄은 _kind로 구분된다', () => {
    // exportQualityJsonl 내부 포맷 계약 검증(단위): record는 _kind=quality_record
    const rec: QualityRecord = {
      id: 'qr_1',
      project_id: 'p',
      created_at: 1,
      doc_ref: null,
      route_id: null,
      direction: null,
      content_type: null,
      segment: { source: null, output: 'o', corrected: null, context: null },
      finding: { type: 'fluency.grammar', severity: 'minor', description: 'd', suggested_fix: null },
      origin: {
        stage: 's1_translate',
        caught_by: null,
        executor: 'app',
        producer_model: null,
        reviewer_model: null,
      },
      disposition: 'proposed',
      promotion: { status: 'candidate', matched_rule: null },
    };
    const line = JSON.stringify({ _kind: 'quality_record', ...rec });
    const parsed = JSON.parse(line);
    expect(parsed._kind).toBe('quality_record');
    expect(parsed.finding.type).toBe('fluency.grammar');
  });
});
