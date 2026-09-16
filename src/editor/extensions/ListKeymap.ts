/**
 * 리스트 키맵 수정 (Tab + Backspace).
 *
 * 1) 표 안 리스트 들여쓰기 우선권.
 * 표 셀 안 불릿에서 Tab/Shift-Tab을 누르면 들여쓰기가 아니라 표 셀 이동이
 * 실행된다. 키맵 플러그인은 `[...extensions].reverse()` 뒤 priority 내림차순
 * stable sort라 전부 100이면 등록 역순이고, `TipTapEditor`는
 * StarterKit(ListItem)보다 Table을 뒤에 등록하므로 Table의 Tab(`goToNextCell`)이
 * ListItem의 Tab(`sinkListItem`)보다 먼저 시도된다. priority를 올려 표 안
 * 리스트에서만 sink/lift를 먼저 시도하고, false면 표 셀 이동으로 폴백한다.
 *
 * 2) 불릿 시작점 Backspace 텍스트 합치기 (표 안/밖 공통).
 * 기본 `joinBackward`는 두 불릿을 하나의 아이템 안의 두 문단으로 합쳐 불릿 하나에
 * 두 줄이 들어간다. 시작점에서 지우면 윗 불릿 끝에 이어 붙이고(마크·이미지 유지),
 * 빈 불릿이면 리스트에서 끌어올린다. 해당 없으면 false로 기본 키맵에 넘긴다.
 *
 * 스키마(노드·마크)를 건드리지 않으므로 converter의 getExtensions에 넣지 않는다.
 */
import { Extension, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

type ListItemType = 'listItem' | 'taskItem';

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * 커서가 속한 가장 안쪽 listItem/taskItem을 찾는다. 표 안에 있을 때만 타입을
 * 돌려준다 (Tab/Shift-Tab이 표 셀 이동과 충돌하는 범위가 여기라서).
 */
function innermostListItemInTable(editor: Editor): ListItemType | null {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) return null;
  const $from = selection.$from;
  let listType: ListItemType | null = null;
  let inTable = false;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (!listType && (name === 'listItem' || name === 'taskItem')) {
      listType = name;
    }
    if (name === 'table') {
      inTable = true;
      break;
    }
    if (name === 'doc') break;
  }
  return inTable ? listType : null;
}

interface ListItemContext {
  listType: ListItemType;
  /** 현재 listItem의 시작 pos (노드 앞). */
  itemPos: number;
  /** 현재 listItem이 속한 리스트 안의 인덱스. */
  itemIndex: number;
  /** 이전 형제 listItem. itemIndex > 0일 때만 있다. */
  prevItemPos: number;
}

/**
 * collapsed 커서가 listItem/taskItem의 **첫 문단 시작**에 있을 때 문맥을 읽는다.
 * 아니면 null — 기본 키맵(표 이동·joinBackward 등)으로 폴백한다.
 */
function listItemStartContext(editor: Editor): ListItemContext | null {
  const { selection } = editor.state;
  if (selection.from !== selection.to) return null;
  if (selection instanceof CellSelection) return null;
  const $from = selection.$from;
  if ($from.parentOffset !== 0) return null;
  const paragraph = $from.parent;
  if (!paragraph.isTextblock || paragraph.type.name !== 'paragraph') return null;

  const itemDepth = $from.depth - 1;
  if (itemDepth < 1) return null;
  const item = $from.node(itemDepth);
  if (item.type.name !== 'listItem' && item.type.name !== 'taskItem') return null;
  // 리스트 아이템의 첫 자식이 아니면(중첩 구조의 뒷부분) 건드리지 않는다.
  if ($from.index(itemDepth) !== 0) return null;

  const listDepth = itemDepth - 1;
  const list = $from.node(listDepth);
  if (!LIST_NODE_NAMES.has(list.type.name)) return null;

  const itemIndex = $from.index(listDepth);
  const itemPos = $from.before(itemDepth);
  const prevItem = itemIndex > 0 ? list.child(itemIndex - 1) : null;
  if (!prevItem || prevItem.type.name !== item.type.name) return null;
  return {
    listType: item.type.name,
    itemPos,
    itemIndex,
    prevItemPos: itemPos - prevItem.nodeSize,
  };
}

/**
 * 불릿 시작점 Backspace: 윗 불릿의 마지막 문단에 텍스트를 합친다.
 *
 * 기본 `joinBackward`는 리스트 아이템 경계를 지우면서 두 문단을 **하나의 아이템
 * 안의 두 문단**으로 남긴다 — 불릿 하나에 두 줄이 들어가 줄바꿈이 깨져 보인다.
 * Notion/Docs처럼 윗 문단 끝에 이어 붙이고(마크·이미지 유지) 현재 아이템은 제거한다.
 * 중첩 등 문단이 하나가 아닌 아이템은 스키마(`paragraph block*`)를 깰 수 있어
 * 건드리지 않고 기본 동작으로 폴백한다.
 */
function joinListItemBackward(editor: Editor, context: ListItemContext): boolean {
  const { doc } = editor.state;
  const $from = editor.state.selection.$from;
  const paragraph = $from.parent;
  const item = $from.node($from.depth - 1);
  if (item.childCount !== 1) return false;
  const prevItem = doc.nodeAt(context.prevItemPos);
  const target = prevItem?.lastChild;
  if (!prevItem || !target || target.type.name !== 'paragraph') return false;

  const content = paragraph.content;
  const itemEnd = context.itemPos + item.nodeSize;
  const targetStart = context.prevItemPos + 1 + (prevItem.content.size - target.nodeSize);
  const junction = targetStart + 1 + target.content.size;

  const tr = editor.state.tr;
  // 아이템째로 제거한다. 뒤쪽 삭제라 앞의 junction은 안 밀린다.
  tr.delete(context.itemPos, itemEnd);
  if (content.size > 0) {
    tr.insert(junction, content);
  }
  tr.setSelection(TextSelection.create(tr.doc, junction + content.size));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const ListKeymap = Extension.create({
  name: 'listKeymap',

  // Table(100)·ListItem(100)보다 먼저 키를 받는다. sort는 내림차순이다.
  priority: 200,

  addKeyboardShortcuts() {
    return {
      // ── 표 안 리스트 들여쓰기 우선권 ─────────────────────────────
      // StarterKit(ListItem)보다 Table을 뒤에 등록하므로 Table의 Tab이 먼저
      // 실행돼 표 안 불릿 들여쓰기가 죽는다(마지막 셀 Tab은 행까지 추가).
      // sink/lift가 false면 그대로 폴백해 표 셀 이동을 막지 않는다.
      Tab: () => {
        const listType = innermostListItemInTable(this.editor);
        if (!listType) return false;
        return this.editor.commands.sinkListItem(listType);
      },
      'Shift-Tab': () => {
        const listType = innermostListItemInTable(this.editor);
        if (!listType) return false;
        return this.editor.commands.liftListItem(listType);
      },
      // ── 불릿 시작점 Backspace 텍스트 합치기 ───────────────────────
      // 기본 joinBackward가 아이템 경계만 지워 한 불릿에 두 문단을 남긴다.
      // 빈 불릿(유일한 빈 문단)은 리스트에서 끌어올려 불릿을 제거한다.
      // 해당 없으면 false로 기본 키맵에 넘긴다.
      Backspace: () => {
        // listItemStartContext가 null이면 첫 아이템이므로 기본 동작(리스트 탈출)에 맡긴다.
        const context = listItemStartContext(this.editor);
        if (!context) return false;
        const $from = this.editor.state.selection.$from;
        const item = $from.node($from.depth - 1);
        if (item.childCount !== 1) return false;
        if ($from.parent.content.size === 0) {
          return this.editor.commands.liftListItem(context.listType);
        }
        return joinListItemBackward(this.editor, context);
      },
    };
  },
});
