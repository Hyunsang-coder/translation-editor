import type {
  ChatToolProfile,
  ContextManifest,
  WorkflowContextMode,
} from '@/types';
import { approxTokens } from '@/ai/chatContext/tokenBudget';

export interface AiDryRunInput {
  mode: WorkflowContextMode;
  toolProfile: ChatToolProfile;
  boundToolNames: string[];
  toolSchemas?: unknown[];
  selectionText?: string;
  alignedSourceText?: string;
  contextManifest: ContextManifest;
  wholeSourceIncluded: boolean;
  wholeTargetIncluded: boolean;
  additionalInputText?: string;
}

export interface AiDryRunReport {
  mode: WorkflowContextMode;
  toolProfile: ChatToolProfile;
  boundToolNames: string[];
  toolSchemaEstimatedTokens: number;
  selectionChars: number;
  alignedSourceChars: number;
  includedMemoryItemIds: string[];
  includedForbiddenTermIds: string[];
  includedGlossaryEntryIds: string[];
  wholeSourceIncluded: boolean;
  wholeTargetIncluded: boolean;
  estimatedTotalInputTokens: number;
}

export function buildAiDryRunReport(input: AiDryRunInput): AiDryRunReport {
  const toolSchemaText = JSON.stringify(input.toolSchemas ?? []);
  const selectionText = input.selectionText ?? '';
  const alignedSourceText = input.alignedSourceText ?? '';
  const additionalInputText = input.additionalInputText ?? '';
  const toolSchemaEstimatedTokens = approxTokens(toolSchemaText);

  return {
    mode: input.mode,
    toolProfile: input.toolProfile,
    boundToolNames: [...input.boundToolNames],
    toolSchemaEstimatedTokens,
    selectionChars: selectionText.length,
    alignedSourceChars: alignedSourceText.length,
    includedMemoryItemIds: [...input.contextManifest.projectMemoryItemIds],
    includedForbiddenTermIds: [...input.contextManifest.forbiddenTermIds],
    includedGlossaryEntryIds: [...input.contextManifest.glossaryEntryIds],
    wholeSourceIncluded: input.wholeSourceIncluded,
    wholeTargetIncluded: input.wholeTargetIncluded,
    estimatedTotalInputTokens:
      toolSchemaEstimatedTokens
      + approxTokens(selectionText)
      + approxTokens(alignedSourceText)
      + approxTokens(additionalInputText)
      + (input.contextManifest.estimatedInputTokens ?? 0),
  };
}

export function formatAiDryRunReport(report: AiDryRunReport): string {
  return [
    '═══════════════════════════════════════════════════════════',
    `              ${report.mode.toUpperCase()} MODE - DRY RUN`,
    '═══════════════════════════════════════════════════════════',
    `mode: ${report.mode}`,
    `tool profile: ${report.toolProfile}`,
    `bound tool names: ${report.boundToolNames.join(', ') || '(none)'}`,
    `tool schema estimated tokens: ${report.toolSchemaEstimatedTokens}`,
    `selection chars: ${report.selectionChars}`,
    `aligned source chars: ${report.alignedSourceChars}`,
    `included memory item IDs: ${report.includedMemoryItemIds.join(', ') || '(none)'}`,
    `included forbidden term IDs: ${report.includedForbiddenTermIds.join(', ') || '(none)'}`,
    `included glossary entry IDs: ${report.includedGlossaryEntryIds.join(', ') || '(none)'}`,
    `whole source included: ${report.wholeSourceIncluded}`,
    `whole target included: ${report.wholeTargetIncluded}`,
    `estimated total input tokens: ${report.estimatedTotalInputTokens}`,
    '✅ VALIDATION PASSED',
    '═══════════════════════════════════════════════════════════',
  ].join('\n');
}
