import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { ImageOriginal } from '@/editor/extensions/ImagePlaceholder';
import { htmlToTipTapJson, type TipTapDocJson } from '@/utils/markdownConverter';
import { createDocumentFromContent, replaceDocContent } from './replaceDocContent';

const IMG = 'https://x.test/a.png';

/** 실제 에디터(TipTapEditor.tsx)처럼 image는 inline, Link는 설정에 따라 선택. */
function createEditor(withLink: boolean): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      ImageOriginal.configure({ inline: true, allowBase64: true }),
      ...(withLink ? [Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false })] : []),
    ],
    content: '<p>old</p>',
  });
}

describe('createDocumentFromContent (JSON 입력)', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('listItem 직속 block image를 paragraph로 감싸 에디터 스키마에 유효하게 만든다', () => {
    editor = createEditor(true);
    // 프로젝트 로드 직후 store targetDocJson(= MCP get_target_document tiptap_json)과 같은 구조
    const docJson = htmlToTipTapJson(`<ul><li><p>a</p><p><img src="${IMG}"></p></li></ul>`);

    const doc = createDocumentFromContent(editor, docJson);

    expect(() => doc.check()).not.toThrow();
    const listItem = doc.firstChild!.firstChild!;
    expect(listItem.child(1).type.name).toBe('paragraph');
    expect(listItem.child(1).firstChild!.type.name).toBe('image');
  });

  it('에디터 스키마에 없는 마크(link)는 벗기고 텍스트는 보존한다', () => {
    editor = createEditor(false);
    const docJson: TipTapDocJson = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://a.test' } }, { type: 'bold' }] },
        ],
      }],
    };

    const doc = createDocumentFromContent(editor, docJson);

    expect(doc.textContent).toBe('see x');
    const marked = doc.firstChild!.child(1);
    expect(marked.marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('정규화로도 고칠 수 없는 구조는 에디터에 넣기 전에 명확히 실패한다', () => {
    editor = createEditor(true);
    const invalid: TipTapDocJson = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'text', text: 'loose text' }] }],
    };

    expect(() => replaceDocContent(editor!, invalid)).toThrow(/Invalid content/);
    expect(editor.getHTML()).toBe('<p>old</p>');
  });
});
