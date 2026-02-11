/**
 * Editor Store - TipTap 에디터 인스턴스 관리
 *
 * EditorCanvasTipTap에서 Source/Target 에디터를 등록하고,
 * projectStore에서 프로젝트 전환 시 정리합니다.
 *
 * 이전: 전역 변수 (editorRegistry.ts)
 * 현재: Zustand 상태 관리로 전환하여
 *  - 메모리 누수 위험 감소
 *  - React 라이프사이클 통합
 *  - 타입 안정성 향상
 */

import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

interface EditorState {
  sourceEditor: Editor | null;
  targetEditor: Editor | null;
  setSourceEditor: (editor: Editor | null) => void;
  setTargetEditor: (editor: Editor | null) => void;
  /**
   * 프로젝트 전환 시 호출
   * 이전 프로젝트의 에디터 참조를 정리하여 메모리 누수 방지
   */
  clearEditors: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  sourceEditor: null,
  targetEditor: null,

  setSourceEditor: (editor: Editor | null): void => {
    set({ sourceEditor: editor });
  },

  setTargetEditor: (editor: Editor | null): void => {
    set({ targetEditor: editor });
  },

  clearEditors: (): void => {
    set({ sourceEditor: null, targetEditor: null });
  },
}));
