import { describe, expect, it } from 'vitest';
import { resolveInitialAlignedSourceRange } from './alignedSelectionRange';

describe('resolveInitialAlignedSourceRange', () => {
  it('Source/Target 문장 수가 같고 선택이 한 문장 안이면 대응 Source 문장으로 좁힌다', () => {
    const targetUnitText = '첫 번째 번역입니다. 두 번째 번역을 수정합니다.';
    const selected = '두 번째 번역';
    const start = targetUnitText.indexOf(selected);

    expect(resolveInitialAlignedSourceRange({
      sourceUnitText: 'This is the first sentence. Revise the second translation.',
      targetUnitText,
      targetSelectionStart: start,
      targetSelectionEnd: start + selected.length,
    })).toEqual({
      text: 'Revise the second translation.',
      precision: 'sentence',
    });
  });

  it('선택이 여러 Target 문장에 걸치면 Source 유닛 전체로 안전하게 폴백한다', () => {
    const sourceUnitText = 'First sentence. Second sentence.';
    const targetUnitText = '첫 문장입니다. 둘째 문장입니다.';

    expect(resolveInitialAlignedSourceRange({
      sourceUnitText,
      targetUnitText,
      targetSelectionStart: 2,
      targetSelectionEnd: targetUnitText.length - 2,
    })).toEqual({ text: sourceUnitText, precision: 'unit' });
  });

  it('Source/Target 문장 수가 다르면 순번으로 범위를 추측하지 않는다', () => {
    const sourceUnitText = 'One sentence with two clauses.';
    const targetUnitText = '첫 문장입니다. 둘째 문장입니다.';

    expect(resolveInitialAlignedSourceRange({
      sourceUnitText,
      targetUnitText,
      targetSelectionStart: 0,
      targetSelectionEnd: '첫 문장입니다.'.length,
    })).toEqual({ text: sourceUnitText, precision: 'unit' });
  });
});
