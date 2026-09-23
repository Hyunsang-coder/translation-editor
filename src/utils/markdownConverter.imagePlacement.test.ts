import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ImageOriginal } from '@/editor/extensions/ImagePlaceholder';
import { AppliedChangeHighlight } from '@/editor/extensions/AppliedChangeHighlight';
import { TranslationUnitId } from '@/editor/extensions/TranslationUnitId';
import {
  htmlToTipTapJson,
  tipTapJsonToMarkdownForTranslation,
  parseTranslationResponseToTipTap,
  wrapBlockImagesInParagraphs,
  type TipTapDocJson,
} from './markdownConverter';
import { prepareImageAnchors, restoreImageAnchors } from './imageAnchors';

/**
 * 실제 에디터(TipTapEditor.tsx)와 동일한 이미지 스키마(inline image)로
 * 번역 결과 JSON을 재귀 검증한다. invalid 구조(listItem 직속 image 등)가
 * 있으면 "Invalid content for node listItem"을 던진다.
 */
function buildRealSchemaEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageOriginal.configure({ inline: true, allowBase64: true }),
      AppliedChangeHighlight,
      TranslationUnitId.configure({ assignMissingIds: false }),
    ],
  });
}

function expectValidForRealEditor(doc: TipTapDocJson): void {
  const editor = buildRealSchemaEditor();
  try {
    editor.schema.nodeFromJSON(doc).check();
  } finally {
    editor.destroy();
  }
}

function collectByType(doc: TipTapDocJson, type: string): TipTapDocJson[][] {
  const parents: TipTapDocJson[][] = [];
  const visit = (node: TipTapDocJson, parent: TipTapDocJson | null): void => {
    if (node.type === type && parent) parents.push([parent, node]);
    const content = Array.isArray(node.content) ? node.content as TipTapDocJson[] : [];
    content.forEach((child) => {
      if (child && typeof child === 'object') visit(child as TipTapDocJson, node);
    });
  };
  visit(doc, null);
  return parents;
}

describe('wrapBlockImagesInParagraphs', () => {
  it('listItem 직속 image를 paragraph로 감싼다', () => {
    const doc = wrapBlockImagesInParagraphs({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '텍스트' }] },
            { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'a', title: null } },
          ],
        }],
      }],
    });

    const listItem = ((doc.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!;
    const children = listItem.content as TipTapDocJson[];
    expect(children).toHaveLength(2);
    expect(children[1]!.type).toBe('paragraph');
    expect((children[1]!.content as TipTapDocJson[])[0]!.type).toBe('image');
    expectValidForRealEditor(doc);
  });

  it('doc·tableCell 직속 image도 감싸고 paragraph 안 image는 그대로 둔다', () => {
    const doc = wrapBlockImagesInParagraphs({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://example.com/top.png', alt: 't', title: null } },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '앞 ' },
            { type: 'image', attrs: { src: 'https://example.com/in.png', alt: 'i', title: null } },
            { type: 'text', text: ' 뒤' },
          ],
        },
      ],
    });

    const content = doc.content as TipTapDocJson[];
    expect(content[0]!.type).toBe('paragraph');
    expect((content[0]!.content as TipTapDocJson[])[0]).toMatchObject({ type: 'image' });
    // paragraph 안 구조는 손대지 않는다 (자식 수·순서 유지)
    expect((content[1]!.content as TipTapDocJson[]).map((n) => n.type)).toEqual(['text', 'image', 'text']);
    expectValidForRealEditor(doc);
  });
});

describe('번역 파이프라인 리스트+이미지 회귀 (TEST 프로젝트 구조)', () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('중첩 리스트 안 이미지 번역 결과가 실제 에디터 스키마에 유효하다', () => {
    const sourceHtml =
      '<ul><li><p>The speed at which aggro increases can be set by designers.</p>' +
      '<ul><li><p>Designers may set intervals (seconds) and how much aggro level increases.</p>' +
      '<p><img src="https://example.com/aggro.png" alt="aggro"></p></li></ul></li></ul>';

    const sourceDoc = htmlToTipTapJson(sourceHtml);
    let seq = 0;
    const prepared = prepareImageAnchors(sourceDoc, () => `img-${++seq}`);
    expect(prepared.anchors).toHaveLength(1);

    const markdown = tipTapJsonToMarkdownForTranslation(prepared.doc);
    expect(markdown).toContain('oddeyes-image-anchor:img-1');

    // LLM이 구조를 유지하고 문장만 번역했다고 가정
    const translatedMarkdown = markdown.replace(
      'Designers may set intervals (seconds) and how much aggro level increases.',
      '디자이너는 간격(초)과 어그로 수치의 증가량을 설정할 수 있다.',
    );

    const parsed = parseTranslationResponseToTipTap(translatedMarkdown);
    const restored = restoreImageAnchors(parsed, prepared.anchors);

    // 원본 이미지 속성이 복원되고, listItem 직속이 아닌 paragraph 안에 있다
    const images = collectByType(restored, 'image');
    expect(images).toHaveLength(1);
    const [parent, image] = images[0]!;
    expect(parent!.type).toBe('paragraph');
    expect(image!.attrs).toMatchObject({ src: 'https://example.com/aggro.png', alt: 'aggro' });

    // 실제 에디터 스키마 재귀 검증 통과 (수정 전에는
    // "Invalid content for node listItem"을 던졌다)
    expectValidForRealEditor(restored);
  });
});

describe('문장 안 이미지 (변환 스키마 inline image)', () => {
  const shape = (doc: TipTapDocJson): string[] =>
    (doc.content as TipTapDocJson[]).map((block) =>
      `${String(block.type)}(${((block.content ?? []) as TipTapDocJson[]).map((n) => String(n.type)).join(',')})`);

  it('문장 안 이미지는 문단을 쪼개거나 빈 문단을 만들지 않는다', () => {
    const doc = htmlToTipTapJson('<p>앞 <img src="https://example.com/a.png" alt="a"> 뒤</p>');

    expect(shape(doc)).toEqual(['paragraph(text,image,text)']);
    expectValidForRealEditor(doc);
  });

  it('번역 왕복 후에도 이미지 뒤 텍스트가 같은 문장에 공백과 함께 남는다', () => {
    const sourceDoc = htmlToTipTapJson('<p>앞 <img src="https://example.com/a.png" alt="a"> 뒤</p><p>다음</p>');
    const prepared = prepareImageAnchors(sourceDoc, () => 'img-1');

    const markdown = tipTapJsonToMarkdownForTranslation(prepared.doc);
    expect(markdown).toBe('앞 ![ODDEYES_IMAGE_img-1](oddeyes-image-anchor:img-1) 뒤\n\n다음');

    const restored = restoreImageAnchors(parseTranslationResponseToTipTap(markdown), prepared.anchors);
    expect(shape(restored)).toEqual(['paragraph(text,image,text)', 'paragraph(text)']);
    expect(((restored.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[2]).toMatchObject({ text: ' 뒤' });
    expectValidForRealEditor(restored);
  });
});
