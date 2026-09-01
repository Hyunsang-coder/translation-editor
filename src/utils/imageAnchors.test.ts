import { describe, expect, it } from 'vitest';
import {
  parseTranslationResponseToTipTap,
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from './markdownConverter';
import {
  hideImageAnchorsFromStreaming,
  prepareImageAnchors,
  restoreImageAnchors,
  type ImageAnchor,
} from './imageAnchors';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function contentOf(node: TipTapDocJson): TipTapDocJson[] {
  return Array.isArray(node.content)
    ? node.content.filter((child): child is TipTapDocJson => Boolean(child && typeof child === 'object'))
    : [];
}

function attrsOf(node: TipTapDocJson): Record<string, unknown> {
  return node.attrs && typeof node.attrs === 'object'
    ? node.attrs as Record<string, unknown>
    : {};
}

function collectImages(doc: TipTapDocJson): TipTapDocJson[] {
  const images: TipTapDocJson[] = [];

  const visit = (node: TipTapDocJson): void => {
    if (node.type === 'image') images.push(node);
    contentOf(node).forEach(visit);
  };

  visit(doc);
  return images;
}

function replaceText(doc: TipTapDocJson, suffix: string): TipTapDocJson {
  const next = clone(doc);

  const visit = (node: TipTapDocJson): void => {
    if (node.type === 'text' && typeof node.text === 'string') {
      node.text = `${node.text}${suffix}`;
    }
    contentOf(node).forEach(visit);
  };

  visit(next);
  return next;
}

function sourceWithImages(): TipTapDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '앞 문단' }],
      },
      {
        type: 'image',
        attrs: {
          src: 'https://example.com/diagram.png',
          alt: 'diagram',
          title: '원본 이미지',
          width: 640,
        },
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '문장 앞 ' },
          {
            type: 'image',
            attrs: {
              src: 'data:image/png;base64,SECRET_BASE64',
              alt: 'inline image',
              title: null,
            },
          },
          { type: 'text', text: ' 문장 뒤' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '목록 안 이미지' }],
              },
              {
                type: 'image',
                attrs: {
                  src: 'https://example.com/list.png',
                  alt: 'list image',
                  title: null,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function sourceWithTableImage(): TipTapDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '표 앞' }],
                  },
                  {
                    type: 'image',
                    attrs: {
                      src: 'https://example.com/table.png',
                      alt: 'table image',
                      title: null,
                    },
                  },
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '표 뒤' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('imageAnchors', () => {
  it('스트리밍 미리보기에서는 완성·미완성 내부 앵커를 숨긴다', () => {
    expect(
      hideImageAnchorsFromStreaming(
        '앞 문장\n![ODDEYES_IMAGE_image-1](oddeyes-image-anchor:image-1)\n뒤 문장',
      ),
    ).toBe('앞 문장\n\n뒤 문장');
    expect(
      hideImageAnchorsFromStreaming(
        '앞 문장\n![ODDEYES_IMAGE_image-1](oddeyes-image-anchor:image-',
      ),
    ).toBe('앞 문장');
  });

  it('원본 이미지 URL을 제거한 번역용 문서를 만들고 이미지 메타데이터를 보존한다', () => {
    const source = sourceWithImages();
    let sequence = 0;

    const prepared = prepareImageAnchors(source, () => `image-${++sequence}`);
    const preparedImages = collectImages(prepared.doc);

    expect(prepared.anchors).toHaveLength(3);
    expect(preparedImages).toHaveLength(3);
    expect(prepared.anchors.map((anchor) => anchor.id)).toEqual([
      'image-1',
      'image-2',
      'image-3',
    ]);
    expect(prepared.anchors.map((anchor) => attrsOf(anchor.node).src)).toEqual([
      'https://example.com/diagram.png',
      'data:image/png;base64,SECRET_BASE64',
      'https://example.com/list.png',
    ]);

    const preparedText = JSON.stringify(prepared.doc);
    expect(preparedText).not.toContain('https://example.com/diagram.png');
    expect(preparedText).not.toContain('SECRET_BASE64');
    expect(preparedText).not.toContain('https://example.com/list.png');

    const markdown = tipTapJsonToMarkdownForTranslation(prepared.doc);
    expect(markdown).not.toContain('https://example.com/diagram.png');
    expect(markdown).not.toContain('SECRET_BASE64');
    expect(markdown).not.toContain('https://example.com/list.png');
    expect(markdown).toContain('image-1');
    expect(markdown).toContain('image-2');
    expect(markdown).toContain('image-3');
  });

  it('번역문 길이가 달라져도 원본 이미지 노드의 위치·속성·순서를 복원한다', () => {
    const source = sourceWithImages();
    let sequence = 0;
    const prepared = prepareImageAnchors(source, () => `image-${++sequence}`);

    const translated = replaceText(prepared.doc, ' 번역문이 길어졌습니다.');
    const restored = restoreImageAnchors(translated, prepared.anchors);
    const restoredImages = collectImages(restored);
    const sourceImages = collectImages(source);

    expect(restoredImages).toEqual(sourceImages);
    expect(contentOf(restored)[0]).toEqual(contentOf(translated)[0]);

    const restoredInlineParagraph = contentOf(restored)[2]!;
    const translatedInlineParagraph = contentOf(translated)[2]!;
    expect(contentOf(restoredInlineParagraph)[0]).toEqual(contentOf(translatedInlineParagraph)[0]);
    expect(contentOf(restoredInlineParagraph)[2]).toEqual(contentOf(translatedInlineParagraph)[2]);
    expect(contentOf(restoredInlineParagraph)[1]).toEqual(sourceImages[1]);

    const restoredList = contentOf(restored)[3]!;
    const translatedList = contentOf(translated)[3]!;
    const restoredListItem = contentOf(restoredList)[0]!;
    const translatedListItem = contentOf(translatedList)[0]!;
    expect(contentOf(restoredListItem)[0]).toEqual(contentOf(translatedListItem)[0]);
    expect(contentOf(restoredListItem)[1]).toEqual(sourceImages[2]);
  });

  it('이미지 앵커가 누락되면 복원하지 않고 오류를 발생시킨다', () => {
    const prepared = prepareImageAnchors(sourceWithImages(), () => 'image-1');
    const translated = clone(prepared.doc);

    translated.content = contentOf(translated).filter((node) => node.type !== 'image');

    expect(() => restoreImageAnchors(translated, prepared.anchors)).toThrow();
  });

  it('이미지 앵커가 중복되거나 순서가 바뀌면 오류를 발생시킨다', () => {
    const source = sourceWithImages();
    let sequence = 0;
    const prepared = prepareImageAnchors(source, () => `image-${++sequence}`);
    const translated = clone(prepared.doc);
    const images = collectImages(translated);

    expect(images).toHaveLength(3);
    images[1]!.attrs = { ...attrsOf(images[1]!), src: attrsOf(images[0]!).src };
    expect(() => restoreImageAnchors(translated, prepared.anchors)).toThrow();

    const reordered = clone(prepared.doc);
    const reorderedContent = reordered.content as TipTapDocJson[];
    const reorderedList = contentOf(reorderedContent[3]!);
    const reorderedListItem = contentOf(reorderedList[0]!);
    const first = reorderedContent[1];
    const last = reorderedListItem[1];
    if (first && last) {
      reorderedContent[1] = last;
      (reorderedList[0]!.content as TipTapDocJson[])[1] = first;
    }
    expect(() => restoreImageAnchors(reordered, prepared.anchors)).toThrow();
  });

  it('이미지가 없는 문서는 변경하지 않고 빈 앵커 목록을 반환한다', () => {
    const source: TipTapDocJson = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '텍스트만 있음' }] }],
    };

    const prepared = prepareImageAnchors(source);

    expect(prepared.anchors).toEqual([]);
    expect(prepared.doc).toEqual(source);
    expect(restoreImageAnchors(source, [] as ImageAnchor[])).toEqual(source);
  });

  it('표 셀 안의 이미지 앵커도 HTML 왕복 후 원본 이미지로 복원한다', () => {
    const source = sourceWithTableImage();
    const prepared = prepareImageAnchors(source, () => 'table-image-1');
    const markdown = tipTapJsonToMarkdownForTranslation(prepared.doc);
    const parsed = parseTranslationResponseToTipTap(markdown);

    const restored = restoreImageAnchors(parsed, prepared.anchors);
    const table = contentOf(restored)[0]!;
    const row = contentOf(table)[0]!;
    const cell = contentOf(row)[0]!;
    const cellImage = contentOf(cell).find((node) => node.type === 'image');

    expect(cellImage).toEqual({
      type: 'image',
      attrs: {
        src: 'https://example.com/table.png',
        alt: 'table image',
        title: null,
      },
    });
  });
});
