import { describe, it, expect } from 'vitest';
import { parseReviewResult, deduplicateIssues } from './parseReviewResult';

describe('parseReviewResult', () => {
  describe('마커 기반 JSON 추출', () => {
    it('---REVIEW_START/END--- 마커 사이의 JSON 파싱', () => {
      const response = `
검토 결과입니다.

---REVIEW_START---
{
  "issues": [
    {
      "segmentOrder": 1,
      "sourceExcerpt": "Hello",
      "targetExcerpt": "안녕",
      "type": "오역",
      "problem": "잘못된 번역"
    }
  ]
}
---REVIEW_END---

위와 같은 문제가 발견되었습니다.
      `;

      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.sourceExcerpt).toBe('Hello');
      expect(issues[0]?.targetExcerpt).toBe('안녕');
      expect(issues[0]?.type).toBe('mistranslation');
    });

    it('응답에 "issues":[] 예시가 있어도 실제 마커 JSON을 우선 파싱', () => {
      const response = `
예시: {"issues": []}

---REVIEW_START---
{
  "issues": [
    {
      "segmentOrder": 1,
      "sourceExcerpt": "Hello",
      "targetExcerpt": "안녕",
      "type": "오역",
      "problem": "잘못된 번역"
    }
  ]
}
---REVIEW_END---
      `;

      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.sourceExcerpt).toBe('Hello');
    });
  });

  describe('brace counting JSON 추출', () => {
    it('마커 없이도 JSON 파싱 가능', () => {
      const response = `
{
  "issues": [
    {
      "segmentOrder": 2,
      "sourceExcerpt": "World",
      "targetExcerpt": "월드",
      "type": "용어",
      "problem": "용어 불일치"
    }
  ]
}
      `;

      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.type).toBe('terminology');
    });

    it('중첩된 중괄호 처리', () => {
      const response = `
Some text before
{
  "issues": [
    {
      "segmentOrder": 1,
      "sourceExcerpt": "{ code }",
      "targetExcerpt": "{ 코드 }",
      "type": "오역",
      "problem": "문제"
    }
  ]
}
Some text after
      `;

      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.sourceExcerpt).toBe('{ code }');
    });
  });

  describe('이슈 타입 분류', () => {
    it('오역 → mistranslation', () => {
      const response = `{"issues": [{"type": "오역", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('mistranslation');
    });

    it('mistranslation → mistranslation', () => {
      const response = `{"issues": [{"type": "mistranslation", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('mistranslation');
    });

    it('누락 → omission', () => {
      const response = `{"issues": [{"type": "누락", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('omission');
    });

    it('추가 → addition', () => {
      const response = `{"issues": [{"type": "추가", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('addition');
    });

    it('뉘앙스 → nuance_shift', () => {
      const response = `{"issues": [{"type": "뉘앙스 변형", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('nuance_shift');
    });

    it('용어 → terminology', () => {
      const response = `{"issues": [{"type": "용어 불일치", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('terminology');
    });

    it('알 수 없는 타입 → mistranslation (기본값)', () => {
      const response = `{"issues": [{"type": "기타", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('mistranslation');
    });
  });

  describe('description 필드 생성', () => {
    it('problem/reason 합성', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "problem": "문제 설명",
          "reason": "이유"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.description).toBe('문제 설명 | 이유');
    });

    it('problem만 있는 경우', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "problem": "문제만"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.description).toBe('문제만');
    });

    it('레거시 description 필드 폴백', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "description": "레거시 설명"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.description).toBe('레거시 설명');
    });
  });

  describe('suggestedFix 처리', () => {
    it('suggestedFix 키 사용', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "suggestedFix": "수정안"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.suggestedFix).toBe('수정안');
    });

    it('suggestion 키 호환성 (소문자)', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "suggestion": "수정안 소문자"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.suggestedFix).toBe('수정안 소문자');
    });

    it('Suggestion 키 호환성 (대문자)', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "Suggestion": "수정안 대문자"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.suggestedFix).toBe('수정안 대문자');
    });

    it('suggestedFix 우선 순위 (suggestedFix > suggestion)', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "a",
          "targetExcerpt": "b",
          "suggestedFix": "우선",
          "suggestion": "후순위"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.suggestedFix).toBe('우선');
    });
  });

  describe('segmentOrder 처리', () => {
    it('숫자로 제공된 경우', () => {
      const response = `{"issues": [{"segmentOrder": 5, "type": "오역", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.segmentOrder).toBe(5);
    });

    it('문자열로 제공된 경우', () => {
      const response = `{"issues": [{"segmentOrder": "3", "type": "오역", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.segmentOrder).toBe(3);
    });

    it('없는 경우 0', () => {
      const response = `{"issues": [{"type": "오역", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.segmentOrder).toBe(0);
    });
  });

  describe('빈 결과 처리', () => {
    it('빈 issues 배열', () => {
      const response = `{"issues": []}`;
      expect(parseReviewResult(response)).toHaveLength(0);
    });

    it('"issues": [] 패턴 감지', () => {
      const response = `문제가 없습니다. {"issues": []}`;
      expect(parseReviewResult(response)).toHaveLength(0);
    });

    it('null/undefined 입력', () => {
      expect(parseReviewResult(null as unknown as string)).toHaveLength(0);
      expect(parseReviewResult(undefined as unknown as string)).toHaveLength(0);
    });

    it('빈 문자열', () => {
      expect(parseReviewResult('')).toHaveLength(0);
    });
  });

  describe('Markdown 형식 파싱 (새 형식)', () => {
    it('Issue # 형식 파싱', () => {
      const response = `
---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "Hello world"
- **Target**: "안녕하세요 세계"
- **Type**: Mistranslation
- **Severity**: Critical
- **SegmentGroupId**: seg-001
- **Explanation**: 의미가 다릅니다
- **Suggestion**: 안녕 세상

---

## Summary
- Critical: 1
- Major: 0
- Minor: 0
---REVIEW_END---
      `;

      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.sourceExcerpt).toBe('Hello world');
      expect(issues[0]?.targetExcerpt).toBe('안녕하세요 세계');
      expect(issues[0]?.type).toBe('mistranslation');
      expect(issues[0]?.severity).toBe('critical');
      expect(issues[0]?.segmentGroupId).toBe('seg-001');
      expect(issues[0]?.description).toBe('의미가 다릅니다');
      expect(issues[0]?.suggestedFix).toBe('안녕 세상');
    });

    it('No issues found 처리', () => {
      const response = `
---REVIEW_START---
## Translation Review Result

Review complete. No issues found.

- Segments reviewed: 5
- Issues detected: 0
---REVIEW_END---
      `;

      const issues = parseReviewResult(response);
      expect(issues).toHaveLength(0);
    });
  });

  describe('AI 오류 응답 감지', () => {
    it('오류 패턴 감지 시 throw', () => {
      const errorResponses = [
        'I cannot review this document',
        'Unable to process the request',
        'Error: API quota exceeded',
        'Rate limit reached',
        'Token limit exceeded',
      ];

      for (const response of errorResponses) {
        expect(() => parseReviewResult(response)).toThrow();
      }
    });
  });
});

describe('deduplicateIssues', () => {
  it('동일 ID 이슈 중복 제거', () => {
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: undefined,
        sourceExcerpt: 'a',
        targetExcerpt: 'b',
        suggestedFix: '',
        type: 'mistranslation' as const,
        severity: 'major' as const,
        description: '설명1',
        checked: true,
      },
      {
        id: 'issue-1', // 중복
        segmentOrder: 1,
        segmentGroupId: undefined,
        sourceExcerpt: 'a',
        targetExcerpt: 'b',
        suggestedFix: '',
        type: 'mistranslation' as const,
        severity: 'major' as const,
        description: '설명2',
        checked: true,
      },
      {
        id: 'issue-2',
        segmentOrder: 2,
        segmentGroupId: undefined,
        sourceExcerpt: 'c',
        targetExcerpt: 'd',
        suggestedFix: '',
        type: 'omission' as const,
        severity: 'critical' as const,
        description: '설명3',
        checked: true,
      },
    ];

    const result = deduplicateIssues(issues);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('issue-1');
    expect(result[0]?.description).toBe('설명1'); // 첫 번째 유지
    expect(result[1]?.id).toBe('issue-2');
  });

  it('빈 배열 처리', () => {
    expect(deduplicateIssues([])).toHaveLength(0);
  });
});
