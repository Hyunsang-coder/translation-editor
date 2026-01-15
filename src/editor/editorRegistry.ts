/**
 * 에디터 인스턴스 레지스트리
 *
 * TipTap 에디터 인스턴스를 글로벌하게 접근할 수 있도록 합니다.
 * ReviewPanel 등에서 에디터의 검색/교체 기능을 직접 사용할 때 필요합니다.
 */

import type { Editor } from '@tiptap/react';

let sourceEditor: Editor | null = null;
let targetEditor: Editor | null = null;

export const setSourceEditor = (editor: Editor | null): void => {
  sourceEditor = editor;
};

export const getSourceEditor = (): Editor | null => sourceEditor;

export const setTargetEditor = (editor: Editor | null): void => {
  targetEditor = editor;
};

export const getTargetEditor = (): Editor | null => targetEditor;
