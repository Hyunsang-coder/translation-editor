import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  TranslationUnitId,
  collectAlignedSourceUnits,
  collectTranslationUnits,
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

  describe('collectAlignedSourceUnits', () => {
    const sourceDoc = ensureTranslationUnitIds({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }, (() => {
      let index = 0;
      return () => `source-${++index}`;
    })());

    it('translationUnitId가 일치하면 ID로 원문 유닛을 찾는다', () => {
      const targetDoc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, translationUnitId: 'source-1' }, content: [{ type: 'text', text: '제목' }] },
          { type: 'paragraph', attrs: { translationUnitId: 'source-2' }, content: [{ type: 'text', text: '본문' }] },
        ],
      };

      const units = collectAlignedSourceUnits(sourceDoc, targetDoc, ['source-2']);

      expect(units.map((unit) => unit.text)).toEqual(['Body']);
    });

    it('ID가 어긋나도 블록 구조가 같으면 같은 위치의 원문으로 fallback한다', () => {
      // legacy 프로젝트: Target 에디터가 독립적으로 부여한 랜덤 ID
      const targetDoc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
          { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
        ],
      };

      const units = collectAlignedSourceUnits(sourceDoc, targetDoc, ['random-b']);

      expect(units.map((unit) => unit.text)).toEqual(['Body']);
    });

    it('ID가 어긋나고 블록 구조도 다르면 빈 배열을 반환한다', () => {
      const targetDoc = {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목과 본문' }] },
        ],
      };

      expect(collectAlignedSourceUnits(sourceDoc, targetDoc, ['random-a'])).toEqual([]);
    });

    it('빈 문단 개수가 달라도 내용 유닛 순서로 fallback 정렬한다', () => {
      // 실제 번역 문서에서 관찰된 케이스: Target에만 빈 문단이 더 있음
      const targetDoc = {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { translationUnitId: 'random-0' } },
          { type: 'heading', attrs: { level: 1, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
          { type: 'paragraph', attrs: { translationUnitId: 'random-c' } },
          { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
        ],
      };

      const units = collectAlignedSourceUnits(sourceDoc, targetDoc, ['random-b']);

      expect(units.map((unit) => unit.text)).toEqual(['Body']);
    });
  });
});
