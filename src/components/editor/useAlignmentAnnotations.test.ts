import { describe, expect, it } from 'vitest';
import { computeAlignmentAnnotations } from '@/components/editor/useAlignmentAnnotations';
import type { AlignOp } from '@/utils/alignUnits';
import type { ReviewIssue } from '@/stores/reviewStore';
import type { UserComment } from '@/stores/commentStore';

function pair(sourceId: string, sourceText: string, targetId: string, targetText: string): AlignOp {
  return {
    kind: 'pair',
    source: { id: sourceId, type: 'paragraph', path: [0], text: sourceText },
    target: { id: targetId, type: 'paragraph', path: [0], text: targetText },
  };
}

function issue(targetExcerpt: string, severity: ReviewIssue['severity'] = 'major'): ReviewIssue {
  return {
    id: `issue-${targetExcerpt}-${severity}`,
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: '',
    targetExcerpt,
    suggestedFix: '',
    type: 'mistranslation',
    severity,
    description: '',
    checked: false,
  };
}

function comment(field: UserComment['field'], excerpt: string, resolved = false): UserComment {
  return {
    id: `cmt-${field}-${excerpt}`,
    field,
    excerpt,
    comment: '메모',
    resolved,
    createdAt: 0,
  };
}

const ops: AlignOp[] = [
  pair('s1', 'The recoil was reduced.', 't1', '반동이 감소했습니다.'),
  pair('s2', 'Throwables changed.', 't2', '투척류가 변경되었습니다.'),
];

describe('computeAlignmentAnnotations', () => {
  it('구절이 들어 있는 유닛에 이슈를 매핑한다', () => {
    const result = computeAlignmentAnnotations(ops, [issue('반동이 감소')], []);

    expect(result.byUnitId.get('t1')?.issueCount).toBe(1);
    expect(result.unmappedIssueCount).toBe(0);
  });

  it('가장 높은 심각도로 배지 색을 정한다', () => {
    const result = computeAlignmentAnnotations(
      ops,
      [issue('반동이', 'minor'), issue('감소했습니다', 'critical')],
      []
    );

    expect(result.byUnitId.get('t1')).toMatchObject({ issueCount: 2, topSeverity: 'critical' });
  });

  it('어느 유닛에도 없는 구절은 매핑하지 않고 따로 센다', () => {
    const result = computeAlignmentAnnotations(ops, [issue('존재하지 않는 구절')], []);

    expect(result.byUnitId.size).toBe(0);
    expect(result.unmappedIssueCount).toBe(1);
  });

  it('여러 유닛에 걸리는 구절은 매핑하지 않는다 — 틀린 위치보다 안 보여주는 게 낫다', () => {
    const duplicated: AlignOp[] = [
      pair('s1', 'a', 't1', '같은 문장입니다.'),
      pair('s2', 'b', 't2', '같은 문장입니다.'),
    ];

    const result = computeAlignmentAnnotations(duplicated, [issue('같은 문장')], []);

    expect(result.byUnitId.size).toBe(0);
    expect(result.unmappedIssueCount).toBe(1);
  });

  it('코멘트는 자기 필드 쪽 유닛에서 찾고, 해결된 것은 세지 않는다', () => {
    const result = computeAlignmentAnnotations(
      ops,
      [],
      [
        comment('source', 'recoil was reduced'),
        comment('target', '투척류가'),
        comment('target', '반동이', true),
      ]
    );

    expect(result.byUnitId.get('s1')?.commentCount).toBe(1);
    expect(result.byUnitId.get('t2')?.commentCount).toBe(1);
    expect(result.byUnitId.get('t1')).toBeUndefined();
  });
});
