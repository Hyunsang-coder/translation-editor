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
import { polishSelection, retranslateSegments, retranslateSelection } from './retranslateSelection';
import { buildLangChainMessages } from '@/ai/prompt';
import { createChatModel } from '@/ai/client';
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

/**
 * 비교군: 같은 픽스처를 **채팅 번역 모드 프롬프트**로 태운다.
 *
 * 사용자가 "채팅에서 다시 번역하면 훨씬 낫다"고 말하는 그 경로다. 선택 편집과 갈리는
 * 후보는 두 가지인데, 이 arm은 그중 **제약 밀도**만 분리해 본다 —
 * 채팅의 진짜 강점인 도구 조회(get_source_document 등)는 여기서 재현하지 않고,
 * 선택 편집과 **같은 분량의 문맥**(원문 한 문장 + 현재 번역문)만 준다.
 *
 * 그래서 해석은 이렇게 갈린다:
 * - 채팅 arm이 여기서도 확연히 낫다 → 원인은 문맥이 아니라 프롬프트(제약·앵커)다.
 * - 채팅 arm도 선택 편집과 비슷하다 → 원인은 문맥 폭(도구 조회) 쪽이다.
 */
describe.skipIf(!LIVE)('비교군 — 채팅 번역 모드 프롬프트', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  it.each(FIXTURES)('채팅으로 다시 번역 — $label', async ({ label, source, target }) => {
    const messages = await buildLangChainMessages(
      {
        project: null,
        contextBlocks: [],
        recentMessages: [],
        userMessage: '선택한 부분을 다시 번역해줘.',
        selection: {
          selectionId: 'live',
          selectionScopeId: 'live',
          projectId: 'live-harness',
          panel: 'target',
          text: target,
          translationUnitIds: [],
          documentRevision: '1',
          anchorStatusAtSend: 'active',
        },
        // 채팅에서는 모델이 도구로 꺼내 가는 값이다. 선택 편집과 문맥량을 맞추려고
        // 픽스처 한 문장만 넣는다.
        sourceDocument: source,
        targetDocument: target,
      },
      { requestType: 'translate' },
    );

    const model = createChatModel(undefined, { useFor: 'chat' });
    const response = await model.invoke(messages);
    const text = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    report('채팅', label, target, text.trim());
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);
});


// ============================================================
// 문서 규모 재현 픽스처 — "열쇠구멍이면 못 맞추는" 케이스
// ============================================================

/**
 * 게임 기획서 한 대목. 위 FIXTURES는 한 문장짜리 명백한 번역투라 어느 경로로 태워도
 * 잘 고쳐졌고, 그래서 사용자가 겪는 증상을 재현하지 못했다. 여기서 노리는 실패는
 * 다른 종류다 — **문장만 보면 답을 알 수 없는 결정**이다.
 *
 * 이 문서는 앞선 블록에서 이미 정해 놓았다:
 *   modifier → 모디파이어 (수정자/변경자 아님)
 *   designer → 기획자     (디자이너 아님)
 *   trigger  → 발동       (트리거 아님)
 *   어체     → `~한다` 개조식 (`~합니다` 아님)
 *
 * 선택 영역 안에는 이 넷 중 어느 것의 근거도 없다. 그래서 문맥을 얼마나 주느냐로
 * 결과가 갈려야 하고, 갈리지 않는다면 문맥 가설도 틀린 것이다.
 */
const SPEC_DOC = {
  sourceBlocks: [
    'Enemy Behavior — Combat Modifiers',
    'Modifiers are optional rule tweaks that designers enable per encounter. Each modifier has a trigger chance evaluated once per spawn.',
    'Allow designers to toggle modifiers to make more interesting scenarios and allow for more variety.',
    'Side step - enemies can perform a quick side step to cover short distances in order to try to avoid danger from the player. This will a have relatively low percentage chance of being triggered (the goal is not to make all enemies mobile, but rather to introduce a semi-rare occurrence where they appear smart).',
    'Cover swap - enemies re-evaluate nearby cover when suppressed.',
  ],
  targetBlocks: [
    '적 행동 — 전투 모디파이어',
    '모디파이어는 기획자가 인카운터별로 켜는 선택적 규칙 변형이다. 각 모디파이어는 스폰마다 한 번 발동 확률을 판정한다.',
    '디자이너들이 더 흥미로운 시나리오를 만들고 더 많은 다양성을 허용하기 위해 수정자를 토글할 수 있도록 허용합니다.',
    '사이드 스텝 - 적들은 플레이어로부터의 위험을 회피하려고 시도하기 위해 짧은 거리를 커버하는 빠른 사이드 스텝을 수행할 수 있습니다. 이것은 트리거될 상대적으로 낮은 퍼센트 확률을 가질 것입니다 (목표는 모든 적들을 이동 가능하게 만드는 것이 아니라, 그들이 똑똑해 보이는 준-희귀한 발생을 도입하는 것입니다).',
    '커버 교체 - 적은 제압당하면 주변 엄폐물을 다시 판정한다.',
  ],
  /** 재번역 대상 블록의 인덱스 */
  targets: [2, 3],
} as const;

/**
 * 문서가 이미 정해 둔 선택을 따랐는지 센다. 눈대중 대신 이 점수로 arm을 비교한다.
 * 각 항목은 맞으면 +1, 문서와 어긋난 표현을 쓰면 -1, 아예 등장하지 않으면 0이다.
 */
function docConsistencyScore(text: string): { score: number; detail: string[] } {
  const checks: Array<{ name: string; good: RegExp; bad: RegExp }> = [
    { name: 'modifier→모디파이어', good: /모디파이어/, bad: /수정자|변경자/ },
    { name: 'designer→기획자', good: /기획자/, bad: /디자이너/ },
    { name: 'trigger→발동', good: /발동/, bad: /트리거/ },
    { name: '어체 ~한다', good: /(한다|된다|있다|이다|없다)[.\s]*$/, bad: /합니다|입니다|습니다/ },
  ];
  const detail: string[] = [];
  let score = 0;
  for (const check of checks) {
    const hasGood = check.good.test(text);
    const hasBad = check.bad.test(text);
    if (!hasGood && !hasBad) {
      detail.push(`${check.name}: -`);
      continue;
    }
    if (hasBad) {
      score -= 1;
      detail.push(`${check.name}: X`);
    } else {
      score += 1;
      detail.push(`${check.name}: O`);
    }
  }
  return { score, detail };
}

function reportDoc(arm: string, index: number, after: string): void {
  const before = SPEC_DOC.targetBlocks[index]!;
  const { score, detail } = docConsistencyScore(after);
  const delta = structureDelta(before, after);
  console.log(
    [
      '',
      `== [${arm}] 블록 ${index} (${PROVIDER})`,
      `   after : ${after}`,
      `   문서정합 ${score >= 0 ? '+' : ''}${score}  (${detail.join(' · ')})`,
      `   delta : 어절 ${delta.wordCount} · 유지율 ${delta.keptWordRatio}`,
    ].join('\n'),
  );
}

/** 선택 유닛 앞뒤 문맥(현재 단일 선택 경로가 실제로 주는 것). */
function surroundingsFor(index: number) {
  return {
    sourceBefore: SPEC_DOC.sourceBlocks.slice(Math.max(0, index - 2), index),
    sourceAfter: SPEC_DOC.sourceBlocks.slice(index + 1, index + 3),
    targetBefore: SPEC_DOC.targetBlocks.slice(Math.max(0, index - 2), index),
    targetAfter: SPEC_DOC.targetBlocks.slice(index + 1, index + 3),
  };
}

describe.skipIf(!LIVE)('문맥 폭이 결과를 가르는가 — 기획서 픽스처', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  // A) 문맥 없음 — 여러 블록 재번역/폴리싱 경로가 실제로 주는 것(surroundings 미전달)
  it.each(SPEC_DOC.targets)('A. 문맥 없이 재번역 - 블록 %i', async (index) => {
    const result = await retranslateSelection({
      projectId: 'live-harness',
      sourceText: SPEC_DOC.sourceBlocks[index]!,
      currentTargetText: SPEC_DOC.targetBlocks[index]!,
      currentTargetUnitText: SPEC_DOC.targetBlocks[index]!,
      targetLanguage: 'Korean',
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });
    reportDoc('A 문맥없음', index, result.replacementText);
    expectUsableReplacement(result.replacementText);
  }, 120_000);

  // B) 앞뒤 2유닛 — 현재 단일 선택 재번역 경로
  it.each(SPEC_DOC.targets)('B. 앞뒤 문맥으로 재번역 - 블록 %i', async (index) => {
    const result = await retranslateSelection({
      projectId: 'live-harness',
      sourceText: SPEC_DOC.sourceBlocks[index]!,
      currentTargetText: SPEC_DOC.targetBlocks[index]!,
      currentTargetUnitText: SPEC_DOC.targetBlocks[index]!,
      targetLanguage: 'Korean',
      surroundings: surroundingsFor(index),
      referenceOptions: REFERENCE_OPTIONS,
      contextSnapshot: EMPTY_SNAPSHOT,
    });
    reportDoc('B 앞뒤2유닛', index, result.replacementText);
    expectUsableReplacement(result.replacementText);
  }, 120_000);

  // C) 문서 전체 — 채팅이 도구로 꺼내 가는 것에 해당
  it.each(SPEC_DOC.targets)('C. 문서 전체를 준 채팅 - 블록 %i', async (index) => {
    const messages = await buildLangChainMessages(
      {
        project: null,
        contextBlocks: [],
        recentMessages: [],
        userMessage: '선택한 부분을 다시 번역해줘.',
        selection: {
          selectionId: 'live',
          selectionScopeId: 'live',
          projectId: 'live-harness',
          panel: 'target',
          text: SPEC_DOC.targetBlocks[index]!,
          translationUnitIds: [],
          documentRevision: '1',
          anchorStatusAtSend: 'active',
        },
        sourceDocument: SPEC_DOC.sourceBlocks.join('\n\n'),
        targetDocument: SPEC_DOC.targetBlocks.join('\n\n'),
      },
      { requestType: 'translate' },
    );
    const model = createChatModel(undefined, { useFor: 'chat' });
    const response = await model.invoke(messages);
    const text = typeof response.content === 'string'
      ? response.content
      : (response.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('');
    reportDoc('C 문서전체', index, text.trim());
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);
});


/**
 * 실제 **여러 블록 경로**(retranslateSegments)로 수정 전후를 잰다.
 *
 * 위 A/B/C는 단일 선택 함수로 문맥 유무만 갈라 본 대리 실험이었다. 여기서는 부분 번역이
 * 실제로 타는 함수를 그대로 부르고, 바뀐 것은 surroundings 전달 하나뿐이다.
 * 블록 2·3을 함께 고른 상황이고, 용어·어체를 정한 블록 0·1은 선택 바깥이다.
 */
describe.skipIf(!LIVE)('여러 블록 경로 — 수정 전후', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  const segmentsInput = () => ({
    projectId: 'live-harness',
    segments: SPEC_DOC.targets.map((index) => ({
      sourceText: SPEC_DOC.sourceBlocks[index]!,
      currentTargetText: SPEC_DOC.targetBlocks[index]!,
    })),
    targetLanguage: 'Korean',
    referenceOptions: REFERENCE_OPTIONS,
    contextSnapshot: EMPTY_SNAPSHOT,
  });

  /** 고른 블록(2·3) 바깥 — 앞은 0·1, 뒤는 4. 실제 getSelectionSurroundings가 주는 모양. */
  const outsideSurroundings = {
    sourceBefore: [SPEC_DOC.sourceBlocks[0]!, SPEC_DOC.sourceBlocks[1]!],
    sourceAfter: [SPEC_DOC.sourceBlocks[4]!],
    targetBefore: [SPEC_DOC.targetBlocks[0]!, SPEC_DOC.targetBlocks[1]!],
    targetAfter: [SPEC_DOC.targetBlocks[4]!],
  };

  it('수정 전 — 문맥 미전달', async () => {
    const result = await retranslateSegments(segmentsInput());
    SPEC_DOC.targets.forEach((index, i) => {
      reportDoc('BEFORE 문맥없음', index, result.replacements[i]!);
      expectUsableReplacement(result.replacements[i]!);
    });
  }, 180_000);

  it('수정 후 — 선택 바깥 앞뒤 문맥 전달', async () => {
    const result = await retranslateSegments({
      ...segmentsInput(),
      surroundings: outsideSurroundings,
    });
    SPEC_DOC.targets.forEach((index, i) => {
      reportDoc('AFTER 문맥있음', index, result.replacements[i]!);
      expectUsableReplacement(result.replacements[i]!);
    });
  }, 180_000);
});
