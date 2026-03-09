import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import DOMPurify from 'dompurify';

/**
 * ProseMirror 트랜잭션으로 에디터 콘텐츠를 교체합니다.
 *
 * `editor.commands.setContent()`와의 차이:
 * - `preventUpdate`를 설정하지 않아 `onUpdate` 콜백이 정상 발동 → store 자동 동기화
 * - `addToHistory` 명시 제어: sync용 false, 번역 적용용 true
 *
 * 보안: string 입력은 DOMPurify로 sanitize 후 innerHTML에 할당합니다.
 * 현재 모든 호출부의 HTML은 내부 생성(buildSourceDocument, buildTargetDocument,
 * store content)이지만, defense-in-depth로 sanitize를 적용합니다.
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
          Object.assign(document.createElement('div'), {
            innerHTML: DOMPurify.sanitize(content),
          }),
        )
      : schema.nodeFromJSON(content);

  const { tr } = state;
  tr.replaceWith(0, state.doc.content.size, newDoc.content);
  if (!addToHistory) tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}
