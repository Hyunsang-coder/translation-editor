/**
 * 인라인 마크 파서 테스트 (Red → Green).
 *
 * 부분 폴리싱/재번역 교체문에 모델이 살려 보낸 `**bold**`, `*italic*`,
 * `` `code` ``를 ProseMirror mark로 되돌리기 위한 순수 파서.
 * `_기울임_` 미지원, `***`·짝 없는 기호·빈 쌍은 리터럴(안전 우선).
 */
import { describe, expect, it } from 'vitest';
import { parseInlineMarks, stripInlineMarks } from './inlineMarkSpans';

describe('parseInlineMarks', () => {
  it('평문은 단일 무마크 스팬이다', () => {
    expect(parseInlineMarks('그냥 문장입니다.')).toEqual([
      { text: '그냥 문장입니다.', marks: [] },
    ]);
  });

  it('**굵게**를 파싱한다', () => {
    expect(parseInlineMarks('a **굵게** b')).toEqual([
      { text: 'a ', marks: [] },
      { text: '굵게', marks: ['bold'] },
      { text: ' b', marks: [] },
    ]);
  });

  it('*기울임*을 파싱한다', () => {
    expect(parseInlineMarks('*기울임* 보통')).toEqual([
      { text: '기울임', marks: ['italic'] },
      { text: ' 보통', marks: [] },
    ]);
  });

  it('`코드`를 파싱한다', () => {
    expect(parseInlineMarks('실행 `npm test` 끝')).toEqual([
      { text: '실행 ', marks: [] },
      { text: 'npm test', marks: ['code'] },
      { text: ' 끝', marks: [] },
    ]);
  });

  it('코드 스팬 안의 **는 리터럴이다', () => {
    expect(parseInlineMarks('`a **b**`')).toEqual([
      { text: 'a **b**', marks: ['code'] },
    ]);
  });

  it('굵게 안에 기울임을 중첩한다', () => {
    expect(parseInlineMarks('**굵고 *기울임* 같이**')).toEqual([
      { text: '굵고 ', marks: ['bold'] },
      { text: '기울임', marks: ['bold', 'italic'] },
      { text: ' 같이', marks: ['bold'] },
    ]);
  });

  it('기울임 안에 굵게를 중첩한다', () => {
    expect(parseInlineMarks('*기울임 **굵게** 계속*')).toEqual([
      { text: '기울임 ', marks: ['italic'] },
      { text: '굵게', marks: ['italic', 'bold'] },
      { text: ' 계속', marks: ['italic'] },
    ]);
  });

  it('닫지 않은 *는 리터럴이다', () => {
    expect(parseInlineMarks('a *b c')).toEqual([{ text: 'a *b c', marks: [] }]);
  });

  it('닫지 않은 **와 백틱은 리터럴이다', () => {
    expect(parseInlineMarks('a **b')).toEqual([{ text: 'a **b', marks: [] }]);
    expect(parseInlineMarks('a `b')).toEqual([{ text: 'a `b', marks: [] }]);
  });

  it('빈 쌍은 리터럴이다(빈 교체 방지)', () => {
    expect(parseInlineMarks('****')).toEqual([{ text: '****', marks: [] }]);
    expect(parseInlineMarks('**')).toEqual([{ text: '**', marks: [] }]);
    expect(parseInlineMarks('``')).toEqual([{ text: '``', marks: [] }]);
  });

  it('*** 세 개는 리터럴이다(지원 범위 밖)', () => {
    expect(parseInlineMarks('***x***')).toEqual([{ text: '***x***', marks: [] }]);
  });

  it('_언더스코어는 리터럴이다(미지원)', () => {
    expect(parseInlineMarks('_snake_case_ 유지')).toEqual([
      { text: '_snake_case_ 유지', marks: [] },
    ]);
  });

  it('같은 마크의 인접 스팬은 합친다', () => {
    expect(parseInlineMarks('**a****b**')).toEqual([
      { text: 'ab', marks: ['bold'] },
    ]);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(parseInlineMarks('')).toEqual([]);
  });
});

describe('stripInlineMarks', () => {
  it('마크만 벗기고 텍스트는 그대로 둔다', () => {
    expect(stripInlineMarks('a **굵게**와 *기울임* `코드`')).toBe('a 굵게와 기울임 코드');
  });

  it('리터럴 기호는 남긴다', () => {
    expect(stripInlineMarks('a *b _c_')).toBe('a *b _c_');
  });
});
