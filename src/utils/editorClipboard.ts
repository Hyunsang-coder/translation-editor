import type { Editor } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import {
  htmlToTipTapJson,
  tipTapJsonToMarkdownForTranslation,
} from './markdownConverter';

export interface RichClipboardContent {
  html: string;
  markdown: string;
}

/**
 * ProseMirror 선택 조각을 외부 붙여넣기에 적합한 HTML과 Markdown으로 변환한다.
 *
 * 부분 목록이나 CellSelection은 열린 Slice일 수 있으므로 JSON을 직접 doc으로
 * 감싸지 않는다. ProseMirror의 클립보드 직렬화가 만든 유효한 HTML을 기존
 * 번역용 Markdown 변환 경로에 통과시켜 블록 구조를 보존한다.
 */
export function serializeSelectionForClipboard(
  editor: Editor,
  slice: Slice,
): RichClipboardContent {
  const { dom } = editor.view.serializeForClipboard(slice);
  const html = dom.innerHTML;
  const markdown = tipTapJsonToMarkdownForTranslation(htmlToTipTapJson(html));

  return { html, markdown };
}

/** HTML과 Markdown 평문을 하나의 클립보드 항목으로 함께 기록한다. */
export async function writeRichClipboard({
  html,
  markdown,
}: RichClipboardContent): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
    }),
  ]);
}
