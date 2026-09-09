import type { Editor } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { writeHtml } from '@tauri-apps/plugin-clipboard-manager';
import { isTauriRuntime } from '@/tauri/invoke';

export interface RichClipboardContent {
  html: string;
  /** 서식 없는 붙여넣기 대상에 넣을 사람용 텍스트. */
  text: string;
}

/**
 * ProseMirror 선택 조각을 외부 붙여넣기에 적합한 HTML과 일반 텍스트로 변환한다.
 * 열린 Slice와 CellSelection도 ProseMirror가 제공하는 클립보드 직렬화 결과를 쓴다.
 */
export function serializeSelectionForClipboard(
  editor: Editor,
  slice: Slice,
): RichClipboardContent {
  const { dom, text } = editor.view.serializeForClipboard(slice);
  const html = dom.innerHTML;

  return { html, text };
}

/** HTML과 일반 텍스트를 하나의 클립보드 항목으로 함께 기록한다. */
export async function writeRichClipboard({
  html,
  text,
}: RichClipboardContent): Promise<void> {
  // WKWebView의 ClipboardItem 구현은 표 CellSelection을 기록하지 못하는 경우가 있다.
  // 데스크톱 앱에서는 Tauri 네이티브 클립보드를 우선해 HTML과 평문을 한 번에 보존한다.
  if (isTauriRuntime()) {
    await writeHtml(html, text);
    return;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);
}
