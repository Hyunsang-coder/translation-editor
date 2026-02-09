import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';

/**
 * ProseMirror 트랜잭션으로 에디터 콘텐츠를 교체합니다.
 *
 * `editor.commands.setContent()`와의 차이:
 * - `preventUpdate`를 설정하지 않아 `onUpdate` 콜백이 정상 발동 → store 자동 동기화
 * - `addToHistory` 명시 제어: sync용 false, 번역 적용용 true
 */
export function replaceDocContent(
  editor: Editor,
  content: string | Record<string, unknown>,
  options: { addToHistory?: boolean } = {},
): void {
  const { addToHistory = true } = options;
  const { state, schema } = editor;

  const newDoc =
    typeof content === 'string'
      ? PMDOMParser.fromSchema(schema).parse(
          Object.assign(document.createElement('div'), { innerHTML: content }),
        )
      : schema.nodeFromJSON(content);

  const { tr } = state;
  tr.replaceWith(0, state.doc.content.size, newDoc.content);
  if (!addToHistory) tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}
