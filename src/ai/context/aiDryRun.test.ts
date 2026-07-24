import { describe, expect, it } from 'vitest';
import { buildAiDryRunReport, formatAiDryRunReport } from './aiDryRun';
import { resolveChatToolNames } from '@/ai/tools/resolveChatTools';

describe('AI context dry-run report', () => {
  it('selection retranslate는 도구와 전체 문서를 포함하지 않는다', () => {
    const boundToolNames = resolveChatToolNames({
      profile: 'selection-retranslate',
      hasProject: true,
      hasTargetSelection: true,
      hasReviewResults: true,
      webEnabled: true,
      confluenceEnabled: true,
      notionEnabled: true,
      explicitDocumentReference: true,
      explicitExternalReference: true,
    });
    const report = buildAiDryRunReport({
      mode: 'selection-retranslate',
      toolProfile: 'selection-retranslate',
      boundToolNames,
      selectionText: '현재 번역문',
      alignedSourceText: 'Current source',
      contextManifest: {
        mode: 'selection-retranslate',
        revision: 12,
        projectMemoryItemIds: ['memory-1'],
        forbiddenTermIds: [],
        glossaryEntryIds: [],
        included: ['selection', 'aligned-source', 'project-memory'],
        estimatedInputTokens: 9,
      },
      wholeSourceIncluded: false,
      wholeTargetIncluded: false,
    });

    expect(report.boundToolNames).toEqual([]);
    expect(report.selectionChars).toBe('현재 번역문'.length);
    expect(report.alignedSourceChars).toBe('Current source'.length);
    expect(report.includedMemoryItemIds).toEqual(['memory-1']);
    expect(report.wholeSourceIncluded).toBe(false);
    expect(report.wholeTargetIncluded).toBe(false);
    expect(formatAiDryRunReport(report)).toContain('✅ VALIDATION PASSED');
  });

  it('manifest에 포함된 감사 ID와 토큰 추정치를 그대로 노출한다', () => {
    const report = buildAiDryRunReport({
      mode: 'selection-chat',
      toolProfile: 'selection-target',
      boundToolNames: ['get_selection_surroundings', 'propose_selection_edit'],
      toolSchemas: [{ name: 'propose_selection_edit', input: { replacementText: 'string' } }],
      selectionText: 'selected target',
      contextManifest: {
        mode: 'selection-chat',
        revision: 5,
        projectMemoryItemIds: ['memory-1'],
        forbiddenTermIds: ['term-1'],
        glossaryEntryIds: ['glossary-1'],
        included: ['selection', 'project-memory', 'forbidden-terms', 'glossary'],
        estimatedInputTokens: 20,
      },
      wholeSourceIncluded: false,
      wholeTargetIncluded: false,
    });

    expect(report.toolSchemaEstimatedTokens).toBeGreaterThan(0);
    expect(report.includedMemoryItemIds).toEqual(['memory-1']);
    expect(report.includedForbiddenTermIds).toEqual(['term-1']);
    expect(report.includedGlossaryEntryIds).toEqual(['glossary-1']);
    expect(report.estimatedTotalInputTokens).toBeGreaterThan(20);
  });
});
