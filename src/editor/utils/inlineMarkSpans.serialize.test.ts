/**
 * 마크 포함 입력 직렬화 테스트 (Red → Green).
 *
 * 모델 입력(currentTargetText)은 평문이라 모델이 원문 서식을 볼 수 없다.
 * 직렬화는 bold/italic/code run을 `**`/`*`/`` ` `` 로 살려 모델 입력에 넣는
 * 용도다. 파서의 역함수 — strip(serialize(x)) === plain 이어야 한다.
 *
 * 의도적 한계(문서화):
 * - bold+italic 겹침 run은 bold만 살린다(italic 탈락, 텍스트 보존).
 * - 백틱을 포함한 code run은 mark 없이 평문으로 둔다.
 * - mark 없는 본문의 `*`/백틱은 raw — 왕복 시 파서가 mark로 읽을 수 있다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { serializeInlineMarks } from './inlineMarkSpans';
import { stripInlineMarks } from './inlineMarkSpans';

describe('serializeInlineMarks', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function setup(content: string): Editor {
    editor = new Editor({ extensions: [StarterKit], content });
    return editor;
  }

  function whole(ed: Editor): string {
    return serializeInlineMarks(ed.state.doc, 0, ed.state.doc.content.size);
  }

  it('평문은 그대로 둔다', () => {
    expect(whole(setup('<p>그냥 문장입니다.</p>'))).toBe('그냥 문장입니다.');
  });

  it('굵게·기울임·코드를 살린다', () => {
    expect(whole(setup('<p>안녕 <strong>세계</strong>와 <em>기울임</em> <code>코드</code></p>')))
      .toBe('안녕 **세계**와 *기울임* `코드`');
  });

  it('부분 범위만 직렬화한다', () => {
    const ed = setup('<p>hello world</p>');
    // 'world' 부분만
    expect(serializeInlineMarks(ed.state.doc, 7, 12)).toBe('world');
  });

  it('부분 범위가 mark 경계를 자르면 열린 mark만 닫는다', () => {
    const ed = setup('<p><strong>hello world</strong></p>');
    expect(serializeInlineMarks(ed.state.doc, 1, 6)).toBe('**hello**');
  });

  it('bold+italic 겹침은 bold만 살리고 텍스트는 보존한다', () => {
    const ed = setup('<p><strong><em>겹침</em></strong> 끝</p>');
    const out = whole(ed);
    expect(stripInlineMarks(out)).toBe('겹침 끝');
    expect(out).toContain('**겹침**');
  });

  it('백틱 포함 code run은 평문으로 둔다', () => {
    const ed = setup('<p>실행 <code>a`b</code> 끝</p>');
    expect(whole(ed)).toBe('실행 a`b 끝');
  });

  it('직렬화→파서 왕복이 평문을 보존한다', () => {
    const ed = setup('<p><strong>굵게</strong>와 <em>기울임</em> <code>코드</code> 평문</p>');
    const out = whole(ed);
    expect(stripInlineMarks(out)).toBe(ed.state.doc.textContent);
  });

  it('인접한 같은 mark 노드는 하나의 쌍으로 합친다', () => {
    const ed = setup('<p><strong>가</strong><strong>나</strong></p>');
    expect(whole(ed)).toBe('**가나**');
  });
});
