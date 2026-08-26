import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  SelectionAnchor,
  createSelectionAnchor,
  markSelectionAnchorStale,
  removeSelectionAnchor,
  resolveSelectionAnchor,
} from '@/editor/extensions/SelectionAnchor';
import { AppliedChangeHighlight } from '@/editor/extensions/AppliedChangeHighlight';
import { CommentMark } from '@/editor/extensions/CommentMark';
import { applySelectionProposal } from './applySelectionProposal';

describe('applySelectionProposal', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  /** 선택 영역(needle)에 앵커를 걸어 채팅 수정안 적용 직전 상태를 만든다. */
  function setup(content: string, needle: string): {
    ed: Editor;
    proposal: { anchorId: string; originalText: string; replacementText: string };
  } {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor, AppliedChangeHighlight, CommentMark],
      content,
    });
    const at = editor.state.doc.textContent.indexOf(needle) + 1;
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: at, to: at + needle.length }],
    });
    return {
      ed: editor,
      proposal: { anchorId, originalText: needle, replacementText: '브라보' },
    };
  }

  function hasCommentMark(ed: Editor, commentId: string): boolean {
    let found = false;
    ed.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.attrs?.commentId === commentId)) {
        found = true;
      }
    });
    return found;
  }

  it('서식이 균일하면 평탄화 없이 적용한다', () => {
    const { ed, proposal } = setup('<p>알파 베타 감마</p>', '베타');

    expect(applySelectionProposal(ed, proposal)).toEqual({
      status: 'applied',
      flattened: false,
      affectedCommentIds: [],
    });
    expect(ed.state.doc.textContent).toBe('알파 브라보 감마');
    // 적용에 성공하면 앵커(하이라이트)가 사라져야 한다
    expect(resolveSelectionAnchor(ed, proposal.anchorId)).toBeNull();
  });

  it('선택 범위 밖을 편집해도 적용된다', () => {
    const { ed, proposal } = setup('<p>알파 베타 감마</p>', '베타');
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, 'XX');

    expect(applySelectionProposal(ed, proposal).status).toBe('applied');
  });

  it('선택 범위 안이 편집됐으면 문서를 건드리지 않고 stale로 판정한다', () => {
    const { ed, proposal } = setup('<p>알파 베타 감마</p>', '베타');
    const range = resolveSelectionAnchor(ed, proposal.anchorId)!.ranges[0]!;
    ed.commands.insertContentAt(range.from + 1, 'X');
    const before = ed.state.doc.textContent;

    expect(applySelectionProposal(ed, proposal)).toEqual({ status: 'stale' });
    expect(ed.state.doc.textContent).toBe(before);
  });

  it('앵커가 제거됐으면(새 선택으로 교체·칩 닫기) stale로 판정한다', () => {
    const { ed, proposal } = setup('<p>알파 베타 감마</p>', '베타');
    removeSelectionAnchor(ed, proposal.anchorId);

    expect(applySelectionProposal(ed, proposal)).toEqual({ status: 'stale' });
    expect(ed.state.doc.textContent).toBe('알파 베타 감마');
  });

  it('앵커가 죽었으면 텍스트가 같아도 stale로 판정한다', () => {
    const { ed, proposal } = setup('<p>알파 베타 감마</p>', '베타');
    markSelectionAnchorStale(ed, proposal.anchorId);

    expect(applySelectionProposal(ed, proposal)).toEqual({ status: 'stale' });
    expect(ed.state.doc.textContent).toBe('알파 베타 감마');
  });

  it('서식이 섞이면 막지 않고 평탄화해 적용하며 그 사실을 알린다', () => {
    const { ed, proposal } = setup(
      '<p>알파 <span data-applied-change data-applied-change-id="c1">베</span>타 감마</p>',
      '베타',
    );

    expect(applySelectionProposal(ed, proposal)).toEqual({
      status: 'applied',
      flattened: true,
      affectedCommentIds: [],
    });
    expect(ed.state.doc.textContent).toBe('알파 브라보 감마');
  });

  it('평탄화로 마크가 사라질 코멘트를 교체 전에 모아 돌려준다', () => {
    const { ed, proposal } = setup(
      '<p>알파 <span data-comment-id="cm1">베</span>타 감마</p>',
      '베타',
    );

    const outcome = applySelectionProposal(ed, proposal);
    expect(outcome).toEqual({
      status: 'applied',
      flattened: true,
      affectedCommentIds: ['cm1'],
    });
    // 평탄화가 부분 코멘트를 지운다 — 호출부가 syncCommentExcerpts로 정리해야 한다
    expect(hasCommentMark(ed, 'cm1')).toBe(false);
  });

  it('선택 전체를 덮는 코멘트는 평탄화 없이 보존된다', () => {
    const { ed, proposal } = setup(
      '<p>알파 <span data-comment-id="cm1">베타</span> 감마</p>',
      '베타',
    );

    const outcome = applySelectionProposal(ed, proposal);
    expect(outcome).toEqual({
      status: 'applied',
      flattened: false,
      affectedCommentIds: ['cm1'],
    });
    expect(hasCommentMark(ed, 'cm1')).toBe(true);
  });
});
