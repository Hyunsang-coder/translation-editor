import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  TranslationUnitId,
  collectTranslationUnits,
  dropAncestorUnits,
  ensureTranslationUnitIds,
  reattachTranslationUnitIds,
} from './TranslationUnitId';

describe('TranslationUnitId', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('HTML/JSON round-trip에서 ID를 보존한다', () => {
    editor = new Editor({
      extensions: [StarterKit, TranslationUnitId],
      content: '<p data-translation-unit-id="unit-a">Hello</p>',
    });

    expect(editor.getJSON().content?.[0]?.attrs?.translationUnitId).toBe('unit-a');
    expect(editor.getHTML()).toContain('data-translation-unit-id="unit-a"');
  });

  it('ID 없는 문서를 로드하면 ID를 자동 부여한다', async () => {
    editor = new Editor({
      extensions: [StarterKit, TranslationUnitId],
      content: '<p>One</p><p>Two</p>',
    });
    // TipTap은 'create' 이벤트를 setTimeout(0)으로 내보낸다
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ids = (editor.getJSON().content ?? []).map(
      (node) => node.attrs?.translationUnitId,
    );
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('setContent로 문서를 교체해도 ID를 자동 부여한다', () => {
    editor = new Editor({
      extensions: [StarterKit, TranslationUnitId],
      content: '<p>One</p>',
    });
    editor.commands.setContent('<p>Replaced</p><p>Another</p>');

    const ids = (editor.getJSON().content ?? []).map(
      (node) => node.attrs?.translationUnitId,
    );
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  // 문단 끝 Enter(새 문단 추가)는 keepOnSplit: false로 ID 복제를 막는다.
  // 문단 중간 분할은 TipTap이 types 없이 ProseMirror split을 불러 attrs가 통째로
  // 복사되므로 여기서 막을 수 없다 — 그 중복은 findAlignedCounterpartUnits가
  // 고유 ID 기준 판정으로 허용한다(alignedCounterpartUnits.test.ts).
  it('문단 끝에서 분할하면 새 블록에 ID를 복제하지 않고 새로 발급한다', () => {
    editor = new Editor({
      extensions: [StarterKit, TranslationUnitId],
      content: '<p data-translation-unit-id="unit-a">Hello</p>',
    });
    editor.commands.setTextSelection(6);
    editor.commands.splitBlock();

    const ids = (editor.getJSON().content ?? []).map(
      (node) => node.attrs?.translationUnitId,
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('unit-a');
    expect(typeof ids[1]).toBe('string');
    expect(ids[1]).not.toBe('unit-a');
  });

  it('assignMissingIds=false면 ID를 부여하지 않는다', () => {
    editor = new Editor({
      extensions: [StarterKit, TranslationUnitId.configure({ assignMissingIds: false })],
      content: '<p>One</p>',
    });

    expect(editor.getJSON().content?.[0]?.attrs?.translationUnitId ?? null).toBeNull();
  });

  it('ID 없는 번역 단위에 ID를 보장한다', () => {
    let nextId = 0;
    const doc = ensureTranslationUnitIds({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
      ],
    }, () => `unit-${++nextId}`);

    expect(collectTranslationUnits(doc).map((unit) => unit.id)).toEqual([
      'unit-1',
      'unit-2',
    ]);
  });

  it('topology가 같으면 Source ID를 Target에 재부착한다', () => {
    const source = ensureTranslationUnitIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }, (() => {
      let index = 0;
      return () => `source-${++index}`;
    })());
    const target = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      ],
    };

    const result = reattachTranslationUnitIds(source, target);

    expect(collectTranslationUnits(result.doc).map((unit) => unit.id)).toEqual([
      'source-1',
      'source-2',
    ]);
    expect(result.unalignedPaths).toEqual([]);
  });

  it('topology가 다르면 임의 ID를 연결하지 않고 unaligned로 기록한다', () => {
    const source = ensureTranslationUnitIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }, () => 'source-id');
    const target = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '제목과 본문' }] },
      ],
    };

    const result = reattachTranslationUnitIds(source, target);

    expect(collectTranslationUnits(result.doc).every((unit) => !unit.id)).toBe(true);
    expect(result.unalignedPaths.length).toBeGreaterThan(0);
  });

  describe('dropAncestorUnits', () => {
    // 표 셀 하나에 제목+문단 두 블록이 든 실제 문서 구조
    const cellDoc = ensureTranslationUnitIds({
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
                  content: [
                    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'AS-IS' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }, (() => {
      let index = 0;
      return () => `source-${++index}`;
    })());

    it('표 셀 안을 선택하면 셀 유닛을 버리고 안쪽 유닛만 남긴다', () => {
      const units = collectTranslationUnits(cellDoc);
      // 셀 + 제목 + 문단 3개가 잡히고, 셀 텍스트는 자식이 구분자 없이 붙는다
      expect(units.map((unit) => unit.text)).toEqual(['AS-ISBody', 'AS-IS', 'Body']);

      expect(dropAncestorUnits(units).map((unit) => unit.text)).toEqual(['AS-IS', 'Body']);
    });

    it('자손이 선택되지 않았으면 셀 유닛을 그대로 둔다', () => {
      const cellOnly = collectTranslationUnits(cellDoc).filter(
        (unit) => unit.type === 'tableCell',
      );

      expect(dropAncestorUnits(cellOnly)).toEqual(cellOnly);
    });
  });
});
