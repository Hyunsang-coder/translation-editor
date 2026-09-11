/**
 * 인라인 서식 유지 적용 테스트 (Red → Green).
 *
 * 모델이 교체문에 살려 보낸 `**bold**`, `*italic*`, `` `code` ``가
 * ProseMirror mark로 들어가야 한다. 마크 없는 출력은 오늘 동작 그대로
 * (범위 균일 mark継承).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { serializeInlineMarks } from './inlineMarkSpans';
import { SelectionAnchor } from '@/editor/extensions/SelectionAnchor';
import {
  createSelectionAnchor,
  resolveSelectionAnchor,
} from '@/editor/extensions/SelectionAnchor';
import { applySelectionEdit, applySelectionEdits } from './applySelectionEdit';

describe('applySelectionEdit — 인라인 서식 유지', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function setup(content: string, from: number, to: number): Editor {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content,
    });
    const anchorId = createSelectionAnchor(editor, { ranges: [{ from, to }] });
    const anchor = resolveSelectionAnchor(editor, anchorId)!;
    (editor as unknown as { __anchor: unknown }).__anchor = anchor;
    return editor;
  }

  function anchorOf(ed: Editor) {
    return (ed as unknown as { __anchor: Parameters<typeof applySelectionEdit>[1] }).__anchor;
  }

  it('**굵게**가 bold mark로 들어간다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), '안녕 **세계**', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.getHTML()).toBe('<p>안녕 <strong>세계</strong></p>');
  });

  it('*기울임*과 `코드`가 각 mark로 들어간다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), '*안녕* `세계`', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.getHTML()).toBe('<p><em>안녕</em> <code>세계</code></p>');
  });

  it('중첩 **굵은 *기울임***이 두 mark로 들어간다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    expect(
      applySelectionEdit(ed, anchorOf(ed), '**굵은 *기울임***', { expectedText: 'hello world' }),
    ).toBe('applied');
    expect(ed.getHTML()).toBe('<p><strong>굵은 <em>기울임</em></strong></p>');
  });

  it('마크 없는 출력은 오늘처럼 범위 균일 mark를継承한다', () => {
    const ed = setup('<p><strong>hello world</strong></p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), '안녕 세계', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.getHTML()).toBe('<p><strong>안녕 세계</strong></p>');
  });

  it('마크 없는 뒷부분은 범위 균일 mark를 받고, 표시된 부분은 파서 mark가 이긴다', () => {
    const ed = setup('<p><strong>hello world</strong></p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), '**안녕** 세계', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.getHTML()).toBe('<p><strong>안녕 세계</strong></p>');
  });

  it('짝 없는 *는 리터럴로 들어가고 삭제되지 않는다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), 'a *b', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.state.doc.textContent).toBe('a *b');
  });

  it('****는 리터럴로 들어가고 원문이 지워지지 않는다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    expect(applySelectionEdit(ed, anchorOf(ed), '****', { expectedText: 'hello world' }))
      .toBe('applied');
    expect(ed.state.doc.textContent).toBe('****');
  });

  it('적용 표시 범위는 마크를 벗긴 길이를 쓴다', () => {
    const ed = setup('<p>hello world</p>', 1, 12);
    applySelectionEdit(ed, anchorOf(ed), '안녕 **세계**', { expectedText: 'hello world' });
    // '안녕 세계' 5자
    expect(ed.state.selection.from).toBe(1);
    expect(ed.state.selection.to).toBe(6);
  });
});

describe('applySelectionEdits — 셀마다 인라인 서식', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('두 셀에 각자 mark가 들어간다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>cell one</p><p>cell two</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [
        { from: 1, to: 9 },
        { from: 11, to: 19 },
      ],
    });
    const anchor = resolveSelectionAnchor(editor, anchorId)!;
    expect(
      applySelectionEdits(editor, anchor, ['**첫째**', '`둘째`'], {
        expectedTexts: ['cell one', 'cell two'],
      }),
    ).toBe('applied');
    expect(editor.getHTML()).toBe('<p><strong>첫째</strong></p><p><code>둘째</code></p>');
  });
});

describe('표 셀 인라인 서식', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const TABLE_EXTENSIONS = [
    StarterKit,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    SelectionAnchor,
  ];

  function posOfText(ed: Editor, text: string): number {
    let from = -1;
    ed.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text === text) from = pos;
    });
    if (from === -1) throw new Error(`text not found: ${text}`);
    return from;
  }

  it('셀 안 서식을 직렬화가 살린다', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content:
        '<table><tbody><tr><td><p>피해량 <strong>12</strong></p></td></tr></tbody></table>',
    });
    const from = posOfText(editor, '피해량 ');
    const end = posOfText(editor, '12');
    expect(serializeInlineMarks(editor.state.doc, from, end + '12'.length)).toBe(
      '피해량 **12**',
    );
  });

  it('셀 안 부분 교체에 bold가 들어가고 표가 깨지지 않는다', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content:
        '<table><tbody><tr><td><p>Alpha target</p></td><td><p>Keep this</p></td></tr></tbody></table>',
    });
    const targetFrom = posOfText(editor, 'Alpha target') + 'Alpha '.length;
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: targetFrom, to: targetFrom + 'target'.length }],
    });
    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, '**표적**', {
        expectedText: 'target',
      }),
    ).toBe('applied');
    const html = editor.getHTML();
    expect(html).toContain('<strong>표적</strong>');
    expect(html).toContain('Keep this');
    expect(html).toContain('<table');
  });

  it('두 셀에 각자 mark가 들어가고 셀 경계가 유지된다', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content:
        '<table><tbody><tr><td><p>cell one</p></td><td><p>cell two</p></td></tr></tbody></table>',
    });
    const oneFrom = posOfText(editor, 'cell one');
    const twoFrom = posOfText(editor, 'cell two');
    const anchorId = createSelectionAnchor(editor, {
      ranges: [
        { from: oneFrom, to: oneFrom + 'cell one'.length },
        { from: twoFrom, to: twoFrom + 'cell two'.length },
      ],
    });
    expect(
      applySelectionEdits(
        editor,
        resolveSelectionAnchor(editor, anchorId)!,
        ['**첫째**', '`둘째`'],
        { expectedTexts: ['cell one', 'cell two'] },
      ),
    ).toBe('applied');
    const html = editor.getHTML();
    expect(html).toContain('<strong>첫째</strong>');
    expect(html).toContain('<code>둘째</code>');
    expect(html).toContain('<table');
  });
});
