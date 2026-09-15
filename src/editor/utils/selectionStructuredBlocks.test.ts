/**
 * 선택 경로 × 구조화 서식 경계 테스트.
 *
 * 부분 폴리싱/재번역의 선택 경로는 평문 교체라 표·리스트 구조를 나를 수 없다.
 * 대신 textblock 단위로 쪼개 블록마다 독립 교체한다. 이 파일은 그 경계를 실제
 * 에디터 문서로 고정한다 — 불릿/중첩/셀 안 불릿/task·ordered 리스트가 각각 몇 개의
 * 범위로 쪼개지고 다중 적용 게이트를 통과하는지.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { SelectionAnchor } from '@/editor/extensions/SelectionAnchor';
import {
  createSelectionAnchor,
  readAnchorText,
  resolveSelectionAnchor,
  splitSelectionAnchorRanges,
} from '@/editor/extensions/SelectionAnchor';
import { canApplySelectionEdits } from './applySelectionEdit';
import { resolveTableColumnHeader } from './tableRangeScope';

const EXTENSIONS = [
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  SelectionAnchor,
];

describe('선택 경로 × 구조화 서식', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function setup(content: string): Editor {
    editor = new Editor({
      extensions: [...EXTENSIONS],
    });
    editor.commands.setContent(content);
    return editor;
  }

  /** 텍스트 노드 시작 위치. 같은 문자열이 여러 번 나오면 occurrence번째(0-based). */
  function posOfText(ed: Editor, text: string, occurrence = 0): number {
    let seen = -1;
    let from = -1;
    ed.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text?.includes(text)) {
        seen += 1;
        if (seen === occurrence) from = pos + (node.text?.indexOf(text) ?? 0);
      }
    });
    if (from === -1) throw new Error(`text not found: ${text}`);
    return from;
  }

  function split(ed: Editor, from: number, to: number) {
    const normalized = splitSelectionAnchorRanges(ed, [{ from, to }]);
    if (!normalized) throw new Error('범위를 정규화하지 못했다');
    const anchorId = createSelectionAnchor(ed, { ranges: normalized.ranges });
    const anchor = resolveSelectionAnchor(ed, anchorId)!;
    return { normalized, anchor };
  }

  it('불릿 2개 드래그는 아이템마다 쪼개지고 다중 적용이 가능하다', () => {
    const ed = setup(
      '<ul><li><p>첫째 항목</p></li><li><p>둘째 항목</p></li></ul>',
    );
    const from = posOfText(ed, '첫째 항목');
    const to = posOfText(ed, '둘째 항목') + '둘째 항목'.length;
    const { normalized, anchor } = split(ed, from, to);

    expect(normalized.ranges).toHaveLength(2);
    expect(normalized.blockCount).toBe(2);
    expect(canApplySelectionEdits(ed, anchor)).toBe(true);
    expect(
      normalized.ranges.map((range) => readAnchorText(ed.state.doc, range.from, range.to)),
    ).toEqual(['첫째 항목', '둘째 항목']);
  });

  it('중첩 불릿은 부모·자식 문단이 서로 다른 블록이다', () => {
    const ed = setup(
      '<ul><li><p>부모 항목</p><ul><li><p>자식 항목</p></li></ul></li></ul>',
    );
    const from = posOfText(ed, '부모 항목');
    const to = posOfText(ed, '자식 항목') + '자식 항목'.length;
    const { normalized, anchor } = split(ed, from, to);

    expect(normalized.ranges).toHaveLength(2);
    expect(canApplySelectionEdits(ed, anchor)).toBe(true);
    expect(
      normalized.ranges.map((range) => readAnchorText(ed.state.doc, range.from, range.to)),
    ).toEqual(['부모 항목', '자식 항목']);
  });

  it('셀 안 불릿 2개는 아이템마다 세그먼트가 되고 헤더가 없으면 열 문맥도 없다', () => {
    const ed = setup(
      '<table><tbody><tr><td><ul><li><p>셀 불릿 하나</p></li><li><p>셀 불릿 둘</p></li></ul></td></tr></tbody></table>',
    );
    const from = posOfText(ed, '셀 불릿 하나');
    const to = posOfText(ed, '셀 불릿 둘') + '셀 불릿 둘'.length;
    const { normalized, anchor } = split(ed, from, to);

    expect(normalized.ranges).toHaveLength(2);
    expect(canApplySelectionEdits(ed, anchor)).toBe(true);
    // 헤더 행이 없는 표라 열 제목 문맥은 붙지 않는다 — 호출부가 빈 채로 보낸다.
    for (const range of normalized.ranges) {
      const header = resolveTableColumnHeader(
        ed.state.doc,
        ed.state.doc.resolve(range.from),
      );
      expect(header).toBeNull();
    }
  });

  it('task·ordered 리스트도 textblock 단위로 쪼개진다', () => {
    const ed = setup(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>할 일 하나</p></li></ul>' +
        '<ol><li><p>순서 하나</p></li><li><p>순서 둘</p></li></ol>',
    );
    const from = posOfText(ed, '할 일 하나');
    const to = posOfText(ed, '순서 둘') + '순서 둘'.length;
    const { normalized, anchor } = split(ed, from, to);

    expect(normalized.ranges).toHaveLength(3);
    expect(canApplySelectionEdits(ed, anchor)).toBe(true);
    expect(
      normalized.ranges.map((range) => readAnchorText(ed.state.doc, range.from, range.to)),
    ).toEqual(['할 일 하나', '순서 하나', '순서 둘']);
  });

  it('불릿+문단 혼합 드래그도 블록마다 분리된다', () => {
    const ed = setup(
      '<ul><li><p>불릿 항목</p></li></ul><p>뒤 문단</p>',
    );
    const from = posOfText(ed, '불릿 항목');
    const to = posOfText(ed, '뒤 문단') + '뒤 문단'.length;
    const { normalized, anchor } = split(ed, from, to);

    expect(normalized.ranges).toHaveLength(2);
    expect(canApplySelectionEdits(ed, anchor)).toBe(true);
  });
});
