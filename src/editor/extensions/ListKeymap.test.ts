import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ImagePlaceholder } from './ImagePlaceholder';
import { ListKeymap } from './ListKeymap';

const TABLE_BULLET_HTML =
  '<table><tbody><tr>' +
  '<td><ul><li><p>첫 번째 항목</p></li><li><p>두 번째 항목</p></li></ul></td>' +
  '<td><p>옆셀</p></td>' +
  '</tr></tbody></table>';

function createEditor(html: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ListKeymap,
      TaskList,
      TaskItem.configure({ nested: true }),
      ImagePlaceholder.configure({ inline: true, allowBase64: true }),
    ],
    content: html,
  });
}

function findTextRange(editor: Editor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.text === text) {
      found = { from: pos, to: pos + node.nodeSize };
    }
    return true;
  });
  if (!found) throw new Error(`텍스트를 찾지 못했습니다: ${text}`);
  return found;
}

/** 실제 키 입력과 같은 ProseMirror 키맵 체인으로 키를 보낸다. */
function fireKey(editor: Editor, key: string, options: { shiftKey?: boolean } = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)) === true;
}

function bulletDepthOf(editor: Editor, text: string): number {
  let depth = -1;
  editor.state.doc.descendants((node) => {
    if (depth >= 0) return false;
    if (node.isText && node.text === text) {
      const $pos = editor.state.doc.resolve(findTextRange(editor, text).from);
      for (let d = $pos.depth; d >= 0; d -= 1) {
        if ($pos.node(d).type.name === 'bulletList') depth += 1;
      }
      return false;
    }
    return true;
  });
  return depth;
}

describe('ListKeymap', () => {
  it('표 안 불릿에서 Tab은 셀 이동이 아니라 들여쓰기를 한다', () => {
    const editor = createEditor(TABLE_BULLET_HTML);
    try {
      const range = findTextRange(editor, '두 번째 항목');
      editor.commands.setTextSelection(range.to);

      expect(fireKey(editor, 'Tab')).toBe(true);
      // 중첩 불릿이 생기고 셀은 그대로 2개다 (행 추가 없음).
      expect(bulletDepthOf(editor, '두 번째 항목')).toBe(1);
      let cells = 0;
      let rows = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableCell') cells += 1;
        if (node.type.name === 'tableRow') rows += 1;
      });
      expect(cells).toBe(2);
      expect(rows).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it('표 안 불릿에서 Shift-Tab은 이전 셀이 아니라 내어쓰기를 한다', () => {
    const editor = createEditor(TABLE_BULLET_HTML);
    try {
      const range = findTextRange(editor, '두 번째 항목');
      editor.commands.setTextSelection(range.to);

      expect(fireKey(editor, 'Tab')).toBe(true);
      expect(bulletDepthOf(editor, '두 번째 항목')).toBe(1);

      expect(fireKey(editor, 'Tab', { shiftKey: true })).toBe(true);
      expect(bulletDepthOf(editor, '두 번째 항목')).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it('표 안 일반 문단에서 Tab은 그대로 다음 셀로 이동한다', () => {
    const editor = createEditor(TABLE_BULLET_HTML);
    try {
      const range = findTextRange(editor, '옆셀');
      editor.commands.setTextSelection(range.to);

      expect(fireKey(editor, 'Tab')).toBe(true);
      // 리스트가 생기지 않는다.
      let lists = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'bulletList') lists += 1;
      });
      expect(lists).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it('표 밖 불릿에서 Tab 들여쓰기는 그대로 동작한다', () => {
    const editor = createEditor('<ul><li><p>첫째</p></li><li><p>둘째</p></li></ul>');
    try {
      const range = findTextRange(editor, '둘째');
      editor.commands.setTextSelection(range.to);

      expect(fireKey(editor, 'Tab')).toBe(true);
      expect(bulletDepthOf(editor, '둘째')).toBe(1);
    } finally {
      editor.destroy();
    }
  });
});

function listItemTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      texts.push(node.textContent);
    }
  });
  return texts;
}

describe('ListKeymap Backspace', () => {
  it('표 안 둘째 불릿 시작점에서 지우면 윗 불릿에 텍스트가 합쳐진다', () => {
    const editor = createEditor(TABLE_BULLET_HTML);
    try {
      const range = findTextRange(editor, '두 번째 항목');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      // 한 불릿에 한 문단으로 합쳐진다 (두 문단으로 나누어지지 않는다).
      expect(listItemTexts(editor)).toEqual(['첫 번째 항목두 번째 항목']);
      let paragraphs = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'paragraph') paragraphs += 1;
      });
      // 셀 안: 합쳐진 불릿 문단 1 + 옆셀 문단 1
      expect(paragraphs).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it('표 밖에서도 동일하게 텍스트가 합쳐진다', () => {
    const editor = createEditor('<ul><li><p>첫째</p></li><li><p>둘째</p></li></ul>');
    try {
      const range = findTextRange(editor, '둘째');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      expect(listItemTexts(editor)).toEqual(['첫째둘째']);
    } finally {
      editor.destroy();
    }
  });

  it('서식과 이미지를 살린 채 합친다', () => {
    const editor = createEditor(
      '<ul><li><p>사진<img src="https://example.com/a.png" alt="보기" /></p></li>' +
        '<li><p><strong>설명</strong> 추가</p></li></ul>',
    );
    try {
      const range = findTextRange(editor, '설명');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      expect(listItemTexts(editor)).toEqual(['사진설명 추가']);

      let images = 0;
      let boldKept = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image') images += 1;
        if (node.isText && node.text === '설명') {
          boldKept = node.marks.some((mark) => mark.type.name === 'bold');
        }
      });
      expect(images).toBe(1);
      expect(boldKept).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('빈 불릿에서 지우면 불릿이 제거된다', () => {
    const editor = createEditor('<ul><li><p>유지</p></li><li><p></p></li></ul>');
    try {
      let emptyPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (emptyPos >= 0) return false;
        if (node.type.name === 'paragraph' && node.textContent === '') {
          emptyPos = pos + 1;
          return false;
        }
        return true;
      });
      editor.commands.setTextSelection(emptyPos);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      expect(listItemTexts(editor)).toEqual(['유지']);
      // 빈 불릿 자리에 일반 문단이 남는다 (리스트 뒤).
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.firstChild?.type.name).toBe('bulletList');
      expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    } finally {
      editor.destroy();
    }
  });

  it('첫 불릿 시작점에서는 기본 동작(리스트 탈출)을 유지한다', () => {
    const editor = createEditor('<ul><li><p>첫째</p></li><li><p>둘째</p></li></ul>');
    try {
      const range = findTextRange(editor, '첫째');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      // 첫째가 일반 문단으로 빠져나오고 둘째만 불릿으로 남는다.
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      expect(listItemTexts(editor)).toEqual(['둘째']);
    } finally {
      editor.destroy();
    }
  });

  it('문단 중간에서는 가로채지 않는다', () => {
    const editor = createEditor('<ul><li><p>첫째</p></li><li><p>둘째</p></li></ul>');
    try {
      const range = findTextRange(editor, '둘째');
      editor.commands.setTextSelection(range.from + 1);

      // jsdom에는 네이티브 삭제가 없어 handled=false이며 문서도 그대로다.
      expect(fireKey(editor, 'Backspace')).toBe(false);
      expect(listItemTexts(editor)).toEqual(['첫째', '둘째']);
    } finally {
      editor.destroy();
    }
  });

  it('taskItem도 동일하게 합쳐진다', () => {
    const editor = createEditor(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>할 일</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>다음</p></li>' +
        '</ul>',
    );
    try {
      const range = findTextRange(editor, '다음');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      expect(listItemTexts(editor)).toEqual(['할 일다음']);
    } finally {
      editor.destroy();
    }
  });

  it('orderedList도 동일하게 합쳐진다', () => {
    const editor = createEditor('<ol><li><p>하나</p></li><li><p>둘</p></li></ol>');
    try {
      const range = findTextRange(editor, '둘');
      editor.commands.setTextSelection(range.from);

      expect(fireKey(editor, 'Backspace')).toBe(true);
      expect(listItemTexts(editor)).toEqual(['하나둘']);
    } finally {
      editor.destroy();
    }
  });

  it('중첩 리스트의 부모 문단에서는 스키마를 깨지 않고 폴백한다', () => {
    const editor = createEditor(
      '<ul><li><p>부모</p><ul><li><p>자식</p></li></ul></li><li><p>다음</p></li></ul>',
    );
    try {
      const range = findTextRange(editor, '다음');
      editor.commands.setTextSelection(range.from);

      fireKey(editor, 'Backspace');
      // 문서가 스키마 유효성을 유지하고 텍스트가 유실되지 않는다.
      expect(() => editor.state.doc.check()).not.toThrow();
      expect(editor.state.doc.textContent).toContain('부모');
      expect(editor.state.doc.textContent).toContain('자식');
      expect(editor.state.doc.textContent).toContain('다음');
    } finally {
      editor.destroy();
    }
  });
});
