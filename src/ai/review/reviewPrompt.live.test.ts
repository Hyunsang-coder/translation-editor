/**
 * 검수 프롬프트의 **실제 효과**를 보는 하네스.
 *
 * 다른 유닛 테스트는 "지시가 프롬프트에 들어갔는가"까지만 보증한다. 문구를 바꿨을 때
 * 모델 출력이 실제로 달라지는지는 실 호출로만 알 수 있어서, 이 파일만 진짜 API를 부른다.
 * 기본은 skip이고 명시적으로 켤 때만 돈다:
 *
 *   LIVE_AI=1 npx vitest run src/ai/review/reviewPrompt.live.test.ts
 *   LIVE_AI=1 LIVE_AI_PROVIDER=anthropic npx vitest run src/ai/review/reviewPrompt.live.test.ts
 *
 * 통과/실패보다 **출력된 이슈 목록과 지표**를 읽는 것이 목적이라, 단정은 "형식이 깨지지
 * 않았다" 수준으로만 건다(selectionPrompt.live.test.ts와 같은 방침).
 *
 * 각 픽스처가 무엇을 가르는지:
 * - 오탐: 결함이 없는 정상 번역. 이슈 개수가 지표.
 * - 문맥: 같은 문단을 (전체 / 선택만+지시 / 선택만-지시)로 돌려 문맥 지시의 효과를 본다.
 * - 최소 수정: 한 단어 결함이 든 긴 문장. 제안문의 어절 유지율이 지표.
 * - 구조/의미: 직역투 + 강도 부사. 구조를 손댔는지와 부사가 살아남았는지가 지표.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runReview } from './runReview';
import { parseReviewResult } from './parseReviewResult';
import type { AlignedSegment } from '@/ai/tools/reviewTool';
import { useAiConfigStore } from '@/stores/aiConfigStore';

const LIVE = process.env.LIVE_AI === '1';
const PROVIDER = process.env.LIVE_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';

function segment(order: number, sourceText: string, targetText: string): AlignedSegment {
  return { groupId: `live-${order}`, order, sourceText, targetText };
}

/** 어절 단위. 구조가 바뀌었는지 보는 데 문장부호까지 셀 필요는 없다. */
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * 제안문이 결함만 고쳤는지(치환) 문장을 다시 썼는지(재작성) 가르는 거친 지표.
 * 유지율이 1에 가까우면 어휘만 손댄 것, 낮으면 문장을 다시 쓴 것이다.
 */
function editDelta(before: string, after: string) {
  const a = words(before);
  const b = words(after);
  const bag = new Map<string, number>();
  for (const word of a) bag.set(word, (bag.get(word) ?? 0) + 1);
  let kept = 0;
  for (const word of b) {
    const count = bag.get(word) ?? 0;
    if (count > 0) {
      kept += 1;
      bag.set(word, count - 1);
    }
  }
  return {
    wordCount: `${a.length} → ${b.length}`,
    keptWordRatio: a.length ? Number((kept / a.length).toFixed(2)) : 0,
    orderChanged: a.some((word, index) => b[index] !== word),
  };
}

/** 이슈 목록과 유형별 지표를 사람이 읽을 형태로 찍는다. */
function report(label: string, response: string): ReturnType<typeof parseReviewResult> {
  const issues = parseReviewResult(response);
  console.log(`\n── ${label} (${PROVIDER}) · 이슈 ${issues.length}개`);
  for (const issue of issues) {
    const delta = issue.targetExcerpt && issue.suggestedFix
      ? editDelta(issue.targetExcerpt, issue.suggestedFix)
      : null;
    console.log(
      [
        `   [${issue.type}/${issue.severity}] ${issue.description}`,
        `     target : ${issue.targetExcerpt || '(missing)'}`,
        `     suggest: ${issue.suggestedFix || '(없음)'}`,
        delta
          ? `     delta  : 어절 ${delta.wordCount} · 유지율 ${delta.keptWordRatio} · 순서변경 ${delta.orderChanged ? 'Y' : 'N'}`
          : '     delta  : (교체 앵커 없음)',
      ].join('\n'),
    );
  }
  return issues;
}

/** 마커가 새어 나오거나 파싱이 깨지는 것만 실패로 본다. 품질 판정은 사람이 한다. */
function expectUsableResponse(response: string): void {
  expect(response.trim().length).toBeGreaterThan(0);
  expect(response).toContain('---REVIEW_START---');
  expect(response).toContain('---REVIEW_END---');
}

// ── 픽스처 ──────────────────────────────────

/** 주어 생략·의역만 있는 정상 번역. 이슈 0개가 정답이다. */
const CLEAN = [
  segment(
    0,
    'Once you complete the tutorial, the reward is added to your inventory automatically.',
    '튜토리얼을 완료하면 보상이 인벤토리에 자동으로 추가됩니다.',
  ),
  segment(
    1,
    'You can check it on the rewards tab at any time.',
    '보상 탭에서 언제든 확인할 수 있습니다.',
  ),
];

/**
 * 두 번째 세그먼트의 주어가 첫 번째 세그먼트에만 있다. 선택 구간만 검수하면 "They"의
 * 지시 대상이 입력에 없어 누락으로 오인하기 쉽다 — 문맥 지시가 이걸 막아야 한다.
 */
const CROSS_CONTEXT = [
  segment(
    0,
    'The season pass unlocks fourteen additional missions.',
    '시즌 패스를 구매하면 추가 미션 14개가 열립니다.',
  ),
  segment(1, 'They can be completed in any order.', '순서에 상관없이 완료할 수 있습니다.'),
];

/** 한 단어(상호작용 키 → 공격 키)만 틀린 긴 문장. 제안문이 그 단어만 고치는지 본다. */
const ONE_WORD_DEFECT = [
  segment(
    0,
    'Press the interact key to open the supply crate, then confirm the transfer in the storage window.',
    '보급 상자를 열려면 공격 키를 누르고, 저장고 창에서 전송을 확인하십시오.',
  ),
];

/**
 * 피동·"~에 의해"가 남은 직역투이면서 강도 부사(즉시·반드시)를 품은 문장.
 * 구조를 손대는지(최소 수정 규칙이 소심하게 만들지 않았는지)와
 * 부사가 살아남는지(의미 불가침)를 한 픽스처에서 같이 본다.
 */
const STRUCTURAL = [
  segment(
    0,
    'Players must immediately report any error that is detected during the match, and the report must include the match ID.',
    '매치 중에 감지되어진 어떠한 오류라도 플레이어에 의해 즉시 보고되어야 하며, 그 보고는 반드시 매치 ID를 포함해야 합니다.',
  ),
];

/**
 * 원문의 뒷절이 번역문에서 통째로 빠진 선택 구간. 빠진 내용이 새 정보라 "입력 밖에서
 * 해소됐다"는 변명이 성립하지 않는다 — 문맥 지시가 진짜 누락까지 억누르는지 본다.
 */
const REAL_OMISSION = [
  segment(
    0,
    'Submit the form before the deadline, and attach the receipt issued by the store.',
    '기한 전에 신청서를 제출하십시오.',
  ),
];

const REVIEW_ARGS = { sourceLanguage: 'English', targetLanguage: 'Korean' } as const;

describe.skipIf(!LIVE)('검수 프롬프트 실 호출', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  it('결함 없는 번역에는 이슈를 만들지 않는다', async () => {
    const response = await runReview({ segments: CLEAN, ...REVIEW_ARGS });
    expectUsableResponse(response);
    const issues = report('오탐 · 정상 번역', response);
    console.log(`   판정  : 이슈 ${issues.length}개 (0이 정답)`);
  }, 120_000);

  it('선행 문장에만 있는 지시 대상을 누락으로 보고하지 않는다 — 문서 전체', async () => {
    const response = await runReview({ segments: CROSS_CONTEXT, ...REVIEW_ARGS });
    expectUsableResponse(response);
    report('문맥 · 두 세그먼트 모두(지시 없음)', response);
  }, 120_000);

  it('선택 구간만 검수할 때 문맥 지시가 오탐을 막는다', async () => {
    const scoped = [segment(0, CROSS_CONTEXT[1]!.sourceText, CROSS_CONTEXT[1]!.targetText)];

    const withDirective = await runReview({
      segments: scoped,
      partialContext: true,
      ...REVIEW_ARGS,
    });
    expectUsableResponse(withDirective);
    const withIssues = report('문맥 · 선택만 + 지시 ON', withDirective);

    const withoutDirective = await runReview({ segments: scoped, ...REVIEW_ARGS });
    expectUsableResponse(withoutDirective);
    const withoutIssues = report('문맥 · 선택만 + 지시 OFF', withoutDirective);

    console.log(
      `   판정  : 지시 ON ${withIssues.length}개 vs OFF ${withoutIssues.length}개 (ON이 더 적어야 지시가 먹은 것)`,
    );
  }, 240_000);

  it('문맥 지시가 켜져도 선택 구간 안의 진짜 누락은 잡는다', async () => {
    const response = await runReview({
      segments: REAL_OMISSION,
      partialContext: true,
      ...REVIEW_ARGS,
    });
    expectUsableResponse(response);
    const issues = report('누락 · 선택만 + 지시 ON', response);
    const omissions = issues.filter((issue) => issue.type === 'omission');
    console.log(
      `   판정  : 누락 ${omissions.length}개 (0이면 문맥 지시가 진짜 누락까지 억누른 것)`,
    );
  }, 120_000);

  it('한 단어 결함에는 그 단어만 고친 제안을 낸다', async () => {
    const response = await runReview({ segments: ONE_WORD_DEFECT, ...REVIEW_ARGS });
    expectUsableResponse(response);
    const issues = report('최소 수정 · 한 단어 결함', response);
    console.log('   판정  : 유지율이 0.8 이상이면 최소 수정, 낮으면 문장 재작성');
    expect(issues.length).toBeGreaterThan(0);
  }, 120_000);

  it('직역투는 구조를 고치면서 강도 부사를 지우지 않는다', async () => {
    const response = await runReview({ segments: STRUCTURAL, ...REVIEW_ARGS });
    expectUsableResponse(response);
    const issues = report('구조/의미 · 직역투 + 강도 부사', response);
    for (const issue of issues) {
      const suggestion = issue.suggestedFix || '';
      const before = issue.targetExcerpt || '';
      const kept = ['즉시', '반드시'].filter(
        (adverb) => !before.includes(adverb) || suggestion.includes(adverb),
      );
      console.log(
        `   판정  : [${issue.type}] 강도 부사 유지 ${kept.length}/2 · 구조 변경 ${
          issue.suggestedFix && before ? (editDelta(before, suggestion).keptWordRatio < 0.8 ? 'Y' : 'N(소심)') : '-'
        }`,
      );
    }
  }, 120_000);
});
