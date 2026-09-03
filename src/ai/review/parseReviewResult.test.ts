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

    it('뉘앙스·톤 변화 → mistranslation', () => {
      const response = `{"issues": [{"type": "뉘앙스 변형", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('mistranslation');
    });

    it('문법 → grammar', () => {
      const response = `{"issues": [{"type": "Grammar", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('grammar');
    });

    it('직역투 → awkward', () => {
      const response = `{"issues": [{"type": "Awkward", "sourceExcerpt": "a", "targetExcerpt": "b"}]}`;
      expect(parseReviewResult(response)[0]?.type).toBe('awkward');
    });

    it('콜로케이션/표현/문장 구조 → awkward', () => {
      const cases = ['Collocation', '표현 어색함', 'Sentence Structure'];
      for (const type of cases) {
        const response = `{"issues": [{"type": "${type}", "sourceExcerpt": "", "targetExcerpt": "b"}]}`;
        expect(parseReviewResult(response)[0]?.type).toBe('awkward');
      }
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

    it('인코딩된 HTML과 Markdown 서식을 제거한다', () => {
      const response = `{
        "issues": [{
          "type": "오역",
          "sourceExcerpt": "source",
          "targetExcerpt": "target",
          "suggestedFix": "문서의 &lt;a href=\\\"https://example.com\\\"&gt;부록&lt;/a&gt;과 **[예시](https://example.com/example)**"
        }]
      }`;

      const issues = parseReviewResult(response);
      expect(issues[0]?.suggestedFix).toBe('문서의 부록과 예시');
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

    it('null/undefined 입력은 불완전한 검수로 처리', () => {
      expect(() => parseReviewResult(null as unknown as string)).toThrow('검수 응답이 비어 있습니다');
      expect(() => parseReviewResult(undefined as unknown as string)).toThrow('검수 응답이 비어 있습니다');
    });

    it('빈 문자열은 불완전한 검수로 처리', () => {
      expect(() => parseReviewResult('')).toThrow('검수 응답이 비어 있습니다');
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

    it('새 NO_ISSUES 형식을 처리', () => {
      const response = `---REVIEW_START---\nNO_ISSUES\n---REVIEW_END---`;
      expect(parseReviewResult(response)).toHaveLength(0);
    });

    it('종료 마커가 없으면 부분 결과를 정상 검수로 수용하지 않는다', () => {
      const response = `
---REVIEW_START---
### Issue #1
- **Source**: "Hello"
- **Target**: "안녕"
- **Type**: Mistranslation
- **Severity**: Major
`;

      expect(() => parseReviewResult(response)).toThrow('검수 응답이 완전하지 않습니다');
    });

    it('파싱할 수 없는 응답을 이슈 없음으로 처리하지 않는다', () => {
      expect(() => parseReviewResult('검수는 완료했지만 정해진 형식으로 출력하지 않았습니다.'))
        .toThrow('검수 응답 형식을 확인할 수 없습니다');
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

describe('감싸는 따옴표 처리', () => {
  it('곡선/CJK 따옴표는 원본대로 보존한다 (감싸기 판단은 apply 시점)', () => {
    const response = `
---REVIEW_START---
### Issue #1
- **Source**: “업무를 수행하는 시점에”
- **Target**: “when executing the task,”
- **Type**: Awkward
- **Severity**: 2
- **SegmentGroupId**: seg-001
- **Explanation**: 번역투입니다
- **Suggestion**: “At the time of performing the task,”
---REVIEW_END---
    `;

    const issues = parseReviewResult(response);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.sourceExcerpt).toBe('“업무를 수행하는 시점에”');
    expect(issues[0]?.targetExcerpt).toBe('“when executing the task,”');
    expect(issues[0]?.suggestedFix).toBe('“At the time of performing the task,”');
  });

  it('Source/Target 직선 따옴표는 regex 옵셔널 "?로 벗겨지고 Suggestion은 원본 보존', () => {
    const response = `
---REVIEW_START---
### Issue #1
- **Source**: "Hello"
- **Target**: "안녕"
- **Type**: Mistranslation
- **Severity**: 5
- **Suggestion**: "안녕하세요"
---REVIEW_END---
    `;

    const issues = parseReviewResult(response);

    expect(issues).toHaveLength(1);
    // Source/Target 라인 regex는 끝의 "?로 직선 따옴표 1쌍을 벗겨낸다
    expect(issues[0]?.sourceExcerpt).toBe('Hello');
    expect(issues[0]?.targetExcerpt).toBe('안녕');
    // Suggestion regex는 (.+)라 따옴표를 보존 → apply 시점에서 문서 기준 조건부 제거
    expect(issues[0]?.suggestedFix).toBe('"안녕하세요"');
  });
});

describe('여러 줄 Suggestion (F6)', () => {
  it('줄바꿈이 있는 교체 단위를 잘라내지 않고 전부 읽는다', () => {
    const response = `
---REVIEW_START---
### Issue #1
- **Source**: "Press Start to begin"
- **Target**: "시작을 눌러 개시하세요"
- **Type**: Awkward
- **Severity**: Minor
- **SegmentGroupId**: seg-1
- **Explanation**: 목록 항목 전체를 교체해야 한다
- **Suggestion**: 첫 줄입니다
둘째 줄입니다
---REVIEW_END---
    `;

    const issues = parseReviewResult(response);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.suggestedFix).toBe('첫 줄입니다\n둘째 줄입니다');
  });

  it('빈 줄·구분선·다음 이슈는 Suggestion에 섞이지 않는다', () => {
    const response = `
---REVIEW_START---
### Issue #1
- **Source**: "A"
- **Target**: "가"
- **Type**: Awkward
- **Severity**: Minor
- **Suggestion**: 제안 첫 줄
제안 둘째 줄

---
### Issue #2
- **Source**: "B"
- **Target**: "나"
- **Type**: Grammar
- **Severity**: Minor
- **Suggestion**: 두 번째 제안
---REVIEW_END---
    `;

    const issues = parseReviewResult(response);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.suggestedFix).toBe('제안 첫 줄\n제안 둘째 줄');
    expect(issues[1]?.suggestedFix).toBe('두 번째 제안');
  });

  it('Suggestion 뒤에 다른 라벨이 오면 거기서 끊는다', () => {
    const response = `
---REVIEW_START---
### Issue #1
- **Source**: "A"
- **Target**: "가"
- **Suggestion**: 제안 본문
- **Type**: Grammar
- **Severity**: Minor
---REVIEW_END---
    `;

    const issues = parseReviewResult(response);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.suggestedFix).toBe('제안 본문');
    expect(issues[0]?.type).toBe('grammar');
  });
});
