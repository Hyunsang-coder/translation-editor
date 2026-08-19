/**
 * 선택 영역 재번역·폴리싱 프롬프트의 **실제 효과**를 보는 하네스.
 *
 * 다른 유닛 테스트는 "지시가 프롬프트에 들어갔는가"까지만 보증한다. 프롬프트 문구를
 * 바꿨을 때 모델 출력이 실제로 달라지는지는 실 호출로만 알 수 있어서, 이 파일만
 * 진짜 API를 부른다. 그래서 기본은 skip이고 명시적으로 켤 때만 돈다:
 *
 *   LIVE_AI=1 npx vitest run src/ai/selectionPrompt.live.test.ts
 *   LIVE_AI=1 LIVE_AI_PROVIDER=anthropic npx vitest run src/ai/selectionPrompt.live.test.ts
 *
 * API 키는 `.env.local`에서 온다(vitest.config.ts가 process.env로 주입 → config.ts가
 * 테스트에서만 fallback 허용). 통과/실패보다 **출력된 before/after와 구조 지표**를
 * 읽는 것이 목적이라, 단정은 "형식이 깨지지 않았다" 수준으로만 건다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { polishSelection, retranslateSelection } from './retranslateSelection';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import type { ContextReferenceOptions, ContextSnapshot } from '@/types';

const LIVE = process.env.LIVE_AI === '1';
const PROVIDER = process.env.LIVE_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';

const REFERENCE_OPTIONS: ContextReferenceOptions = {
  translationRules: false,
  forbiddenTerms: false,
  glossary: false,
  projectMemory: false,
};

const EMPTY_SNAPSHOT: ContextSnapshot = {
  revision: 1,
  projectMemoryItems: [],
  translationRules: '',
  forbiddenTerms: [],
  glossaryEntries: [],
  createdAt: 1,
};

/**
 * 영어 통사구조가 그대로 남은 번역문들. 어휘는 멀쩡하고 **구조만** 어색해서,
 * 모델이 단어 치환에 그치는지 구조를 손대는지가 갈린다.
 */
const FIXTURES = [
  {
    label: '피동 + 긴 관형절',
    source:
      'The match results that were recorded by the server are displayed on the leaderboard within a few minutes.',
    target:
      '서버에 의해 기록된 매치 결과들은 몇 분 이내에 리더보드 위에 표시되어집니다.',
  },
  {
    label: '관계절 중첩',
    source:
      'Players who have completed the tutorial that is provided at the start of the season can claim the reward.',
    target:
      '시즌 시작 시에 제공되는 튜토리얼을 완료한 플레이어들은 보상을 수령하는 것이 가능합니다.',
  },
  {
    label: '명사구 나열 + 형식주어',
    source:
      'It is important to note that the item cannot be traded after it has been equipped once.',
    target:
      '한 번 장착된 이후에는 해당 아이템의 거래가 불가능하다는 점에 대한 주의가 필요하다는 것은 중요합니다.',
  },
] as const;

/** 어절 단위. 구조가 바뀌었는지 보는 데 문장부호까지 셀 필요는 없다. */
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentenceCount(text: string): number {
  return text.split(/[.!?。]|(?<=다)\s/).filter((part) => part.trim()).length;
}

/**
 * 어휘만 갈아끼웠는지 구조를 바꿨는지 가르는 거친 지표.
 *
 * 어절 다중집합이 같으면(=순서만 다름) 재배열, 집합이 달라지면 치환이다. 둘을 나눠
 * 세면 "동의어로 바꾸기만 함"과 "절 순서를 옮김"을 눈으로 구분할 수 있다.
 */
function structureDelta(before: string, after: string) {
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
  const orderChanged = a.some((word, index) => b[index] !== word);
  return {
    wordCount: `${a.length} → ${b.length}`,
    keptWordRatio: a.length ? Number((kept / a.length).toFixed(2)) : 0,
    sentences: `${sentenceCount(before)} → ${sentenceCount(after)}`,
    orderChanged,
  };
}

function report(kind: string, label: string, before: string, after: string): void {
  const delta = structureDelta(before, after);
  console.log(
    [
      '',
      `── ${kind} · ${label} (${PROVIDER})`,
      `   before: ${before}`,
      `   after : ${after}`,
      `   delta : 어절 ${delta.wordCount} · 유지율 ${delta.keptWordRatio} · 문장 ${delta.sentences} · 순서변경 ${delta.orderChanged ? 'Y' : 'N'}`,
    ].join('\n'),
  );
}

/** 마커가 새어 나오거나 빈 응답이 오는 것만 실패로 본다. 품질 판정은 사람이 한다. */
function expectUsableReplacement(text: string): void {
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).not.toContain('---SELECTION_EDIT');
  expect(text).not.toContain('---ALIGNED_SOURCE');
}

/**
 * 두 경로가 정말 다른 일을 하는지 가르는 픽스처.
 *
 * 번역문은 한국어로는 매끄럽지만 **의미가 반대**다(before → after). 원문을 진실로 삼는
 * 재번역은 이걸 고쳐야 하고, 의미 보존이 규칙인 폴리싱은 틀린 채로 두고 표현만 다듬어야
 * 한다. 결과가 같게 나오면 재번역이 아직 기존 번역에 앵커링돼 있다는 증거다.
 */
const MISTRANSLATION = {
  label: '의미가 반대인 번역문',
  source: 'The reward can be claimed only before the season ends.',
  target: '보상은 시즌이 종료된 후에만 수령할 수 있습니다.',
} as const;

/** 시점 표현이 어느 쪽으로 갔는지 — 사람이 읽기 전에 눈에 띄게 찍어 둔다. */
function polarity(text: string): string {
  const hasBefore = /종료되기?\s*전|끝나기\s*전|이전/.test(text);
  const hasAfter = /종료된?\s*후|끝난\s*후|이후/.test(text);
  if (hasBefore && !hasAfter) return '전(원문 일치)';
  if (hasAfter && !hasBefore) return '후(기존 번역 유지)';
  return '판정 불가';
}

describe.skipIf(!LIVE)('재번역과 폴리싱이 갈리는 지점', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  it('재번역은 원문을 진실로 삼아 틀린 의미를 고친다', async () => {
    const result = await retranslateSelection({
      projectId: 'live-harness',
      sourceText: MISTRANSLATION.source,
      currentTargetText: MISTRANSLATION.target,
      currentTargetUnitText: MISTRANSLATION.target,
      targetLanguage: 'Korean',
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });

    report('재번역', MISTRANSLATION.label, MISTRANSLATION.target, result.replacementText);
    console.log(`   의미  : ${polarity(result.replacementText)}  (원문: before / 기존 번역: after)`);
    expectUsableReplacement(result.replacementText);
  }, 120_000);

  it('폴리싱은 틀린 의미를 몰래 고치지 않고 표현만 다듬는다', async () => {
    const result = await polishSelection({
      projectId: 'live-harness',
      sourceText: MISTRANSLATION.source,
      currentTargetText: MISTRANSLATION.target,
      currentTargetUnitText: MISTRANSLATION.target,
      targetLanguage: 'Korean',
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });

    report('폴리싱', MISTRANSLATION.label, MISTRANSLATION.target, result.replacementText);
    console.log(`   의미  : ${polarity(result.replacementText)}  (원문: before / 기존 번역: after)`);
    expectUsableReplacement(result.replacementText);
  }, 120_000);
});

describe.skipIf(!LIVE)('선택 영역 AI 프롬프트 실 호출', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  it.each(FIXTURES)('폴리싱이 구조를 손댄다 — $label', async ({ label, source, target }) => {
    const result = await polishSelection({
      projectId: 'live-harness',
      sourceText: source,
      currentTargetText: target,
      currentTargetUnitText: target,
      targetLanguage: 'Korean',
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });

    report('폴리싱', label, target, result.replacementText);
    expectUsableReplacement(result.replacementText);
  }, 120_000);

  it.each(FIXTURES)('재번역이 기존 번역을 베끼지 않는다 — $label', async ({ label, source, target }) => {
    const result = await retranslateSelection({
      projectId: 'live-harness',
      sourceText: source,
      currentTargetText: target,
      currentTargetUnitText: target,
      targetLanguage: 'Korean',
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });

    report('재번역', label, target, result.replacementText);
    expectUsableReplacement(result.replacementText);
  }, 120_000);
});
