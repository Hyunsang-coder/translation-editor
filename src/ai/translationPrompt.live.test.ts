/**
 * 전체 번역·이어서 번역·이슈 반영 재번역 프롬프트의 실제 효과 하네스.
 *
 * 기본은 skip이다:
 *   LIVE_AI=1 npx vitest run src/ai/translationPrompt.live.test.ts
 *   LIVE_AI=1 LIVE_AI_PROVIDER=anthropic npx vitest run src/ai/translationPrompt.live.test.ts
 *
 * 포맷 무결성은 항상 P0 하드 게이트로 단정한다. 그 뒤의 의미·용어·어체 점수는 기본적으로
 * 출력만 하고, CI/수동 품질 게이트로도 사용하려면 `LIVE_AI_ASSERT_QUALITY=1`을 함께
 * 준다. 모델 변동성과 비용 때문에 일반 단위 테스트에는 포함하지 않는다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { translateWithStreaming } from './translateDocument';
import { tipTapJsonToMarkdownForTranslation, type TipTapDocJson } from '@/utils/markdownConverter';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import type { ITEProject, ResolvedWorkflowContext } from '@/types';
import type { ReviewIssue } from '@/stores/reviewStore';
import { evaluateDocumentIntegrity } from '@/ai/documentIntegrity';
import { createFormatIntegritySourceDoc } from '@/test/fixtures/documentIntegrity';

const LIVE = process.env.LIVE_AI === '1';
const ASSERT_QUALITY = process.env.LIVE_AI_ASSERT_QUALITY === '1';
const PROVIDER = process.env.LIVE_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';

const project = {
  id: 'translation-live-harness',
  version: '1.0.0',
  metadata: {
    title: 'Translation prompt live harness',
    domain: 'game',
    sourceLanguage: '영어',
    targetLanguage: '한국어',
    createdAt: 1,
    updatedAt: 1,
    settings: {
      strictnessLevel: 0.5,
      autoSave: false,
      autoSaveInterval: 30_000,
      theme: 'system',
    },
  },
  segments: [],
  blocks: {},
} as ITEProject;

function doc(...paragraphs: string[]): TipTapDocJson {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

function context(translationRules: string): ResolvedWorkflowContext {
  return {
    snapshot: {
      revision: 1,
      projectMemoryItems: [],
      translationRules,
      forbiddenTerms: [],
      glossaryEntries: [],
      createdAt: 1,
    },
    manifest: {
      mode: 'full-translate',
      revision: 1,
      projectMemoryItemIds: [],
      translationRulesHash: 'live-rules',
      forbiddenTermIds: [],
      glossaryEntryIds: [],
      included: ['translation-rules'],
    },
    rendered: {
      projectMemory: '',
      translationRules,
      forbiddenTerms: '',
      glossary: '',
    },
  };
}

function establishedPlainRegister(text: string): boolean {
  const formal = /합니다|됩니다|있습니다|입니다|하십시오/.test(text);
  const plain = /한다|된다|있다|이다|없다/.test(text);
  return plain && !formal;
}

interface QualityCheck {
  label: string;
  passed: boolean;
}

function report(label: string, markdown: string, checks: QualityCheck[]): number {
  const score = Math.round(
    (checks.filter((check) => check.passed).length / Math.max(1, checks.length)) * 100,
  );
  console.log(
    [
      '',
      `── 전체 번역 · ${label} (${PROVIDER})`,
      `   output: ${markdown}`,
      `   보조 품질: ${score}/100`,
      ...checks.map((check) => `   ${check.passed ? '✓' : '✗'} ${check.label}`),
    ].join('\n'),
  );
  if (ASSERT_QUALITY) expect(score).toBeGreaterThanOrEqual(80);
  return score;
}

function expectUsable(
  source: TipTapDocJson,
  translated: TipTapDocJson,
  markdown: string,
): void {
  expect(markdown.trim().length).toBeGreaterThan(0);
  expect(markdown).not.toContain('---TRANSLATION_START---');
  expect(markdown).not.toContain('---TRANSLATION_END---');
  expect(markdown).not.toContain('---INPUT_DOCUMENT');

  const integrity = evaluateDocumentIntegrity(source, translated);
  console.table(integrity.checks);
  if (!integrity.passed) {
    console.log(JSON.stringify(integrity.issues, null, 2));
  }
  // 포맷은 점수로 상쇄하지 않는다. 하나라도 실패하면 보조 품질을 계산하지 않고 즉시 실패.
  expect(integrity.passed).toBe(true);
}

describe.skipIf(!LIVE)('전체 번역 프롬프트 실 호출', () => {
  beforeAll(() => {
    useAiConfigStore.setState({ provider: PROVIDER });
  });

  it('복합 표·이미지·링크·목록·코드·placeholder를 모두 보존한다 — P0 하드 게이트', async () => {
    const source = createFormatIntegritySourceDoc();
    const { doc: translated } = await translateWithStreaming({
      project,
      sourceDocJson: source,
    });
    const markdown = tipTapJsonToMarkdownForTranslation(translated);

    expectUsable(source, translated, markdown);
    console.log('\n── 전체 번역 · 포맷 무결성 P0: PASS');
  }, 120_000);

  it('이번 실행 추가 지시가 프로젝트 기본 어체보다 우선한다', async () => {
    const source = doc(
      'Players can claim the reward before the season ends.',
      'The menu shows the remaining time.',
    );
    const { doc: translated } = await translateWithStreaming({
      project,
      sourceDocJson: source,
      resolvedContext: context('모든 문장을 정중한 ~합니다체로 번역합니다.'),
      retranslateMessage: '이번 실행에서는 간결한 게임 기획서 문체인 ~한다체를 사용하세요.',
    });
    const markdown = tipTapJsonToMarkdownForTranslation(translated);
    expectUsable(source, translated, markdown);
    report('우선순위 · 실행 지시 > 번역 규칙', markdown, [
      {
        label: '2개 문단 구조 보존',
        passed: Array.isArray(translated.content) && translated.content.length === 2,
      },
      { label: 'reward 의미 보존', passed: /보상/.test(markdown) },
      { label: 'season end 조건 보존', passed: /시즌.*(끝|종료)/.test(markdown) },
      { label: '요청한 ~한다체 유지', passed: establishedPlainRegister(markdown) },
    ]);
  }, 120_000);

  it('이슈 반영 재번역이 기존 문서의 어체만 이어받는다', async () => {
    const source = doc(
      'The scanner marks nearby targets and updates the list every five seconds.',
    );
    const issues: ReviewIssue[] = [{
      id: 'live-issue',
      segmentOrder: 0,
      segmentGroupId: 'live-0',
      sourceExcerpt: 'updates the list every five seconds',
      targetExcerpt: '목록을 매분 갱신한다',
      suggestedFix: '목록을 5초마다 갱신한다',
      type: 'mistranslation',
      severity: 'major',
      description: '갱신 주기가 5초에서 1분으로 바뀌었습니다.',
      checked: true,
    }];
    const { doc: translated } = await translateWithStreaming({
      project,
      sourceDocJson: source,
      resolvedContext: context('자연스러운 한국어로 번역합니다.'),
      reviewIssues: issues,
      currentTargetStyleReference: [
        '스캐너는 주변 표적을 표시한다.',
        '전투 정보는 짧고 단정한 ~한다체로 서술한다.',
      ].join('\n'),
    });
    const markdown = tipTapJsonToMarkdownForTranslation(translated);
    expectUsable(source, translated, markdown);
    report('이슈 반영 · 의미는 Source/이슈, 어체는 기존 Target', markdown, [
      { label: 'scanner 의미 보존', passed: /스캐너/.test(markdown) },
      { label: 'nearby targets 의미 보존', passed: /주변.*표적|근처.*대상/.test(markdown) },
      { label: '5초 주기 복원', passed: /5초/.test(markdown) && !/1분|매분/.test(markdown) },
      { label: '기존 ~한다체 유지', passed: establishedPlainRegister(markdown) },
    ]);
  }, 120_000);

  it('이어서 번역이 직전 번역의 용어와 어체를 유지하고 참고문을 출력하지 않는다', async () => {
    const tail = doc('The modifier activates when the enemy enters the alert state.');
    const referenceTarget = '각 모디파이어는 조건을 만족하면 발동한다.';
    const { doc: translated } = await translateWithStreaming({
      project,
      sourceDocJson: tail,
      continuation: {
        contextPairs: [{
          source: 'Each modifier activates when its condition is met.',
          target: referenceTarget,
        }],
      },
    });
    const markdown = tipTapJsonToMarkdownForTranslation(translated);
    expectUsable(tail, translated, markdown);
    report('이어서 번역 · 직전 용어/어체', markdown, [
      { label: 'modifier→모디파이어', passed: /모디파이어/.test(markdown) },
      { label: 'activate→발동', passed: /발동/.test(markdown) },
      { label: '직전 ~한다체 유지', passed: establishedPlainRegister(markdown) },
      { label: '참고 번역을 중복 출력하지 않음', passed: !markdown.includes(referenceTarget) },
    ]);
  }, 120_000);
});
