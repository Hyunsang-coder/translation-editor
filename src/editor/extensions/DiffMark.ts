/**
 * DiffMark Extension
 * AI 제안 적용 시 삽입/삭제를 시각화하는 마크 확장
 */

import { Mark, mergeAttributes } from '@tiptap/core';

// ============================================
// Insertion Mark (추가된 텍스트)
// ============================================

export interface InsertionMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const InsertionMark = Mark.create<InsertionMarkOptions>({
  name: 'insertion',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-diff-insertion]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-diff-insertion': '',
        class: 'diff-insertion',
      }),
      0,
    ];
  },
});

// ============================================
// Deletion Mark (삭제된 텍스트)
// ============================================

export interface DeletionMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const DeletionMark = Mark.create<DeletionMarkOptions>({
  name: 'deletion',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-diff-deletion]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-diff-deletion': '',
        class: 'diff-deletion',
      }),
      0,
    ];
  },
});

// ============================================
// DiffMark Extension (통합)
// ============================================

export interface DiffMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diffMark: {
      /**
       * 삽입 마크 적용
       */
      setInsertion: () => ReturnType;
      /**
       * 삭제 마크 적용
       */
      setDeletion: () => ReturnType;
      /**
       * 모든 Diff 마크 제거
       */
      clearDiffMarks: () => ReturnType;
      /**
       * Diff 수락 (삭제된 텍스트 제거, 삽입된 텍스트 확정)
       */
      acceptDiff: () => ReturnType;
      /**
       * Diff 거부 (삽입된 텍스트 제거, 삭제된 텍스트 복원)
       */
      rejectDiff: () => ReturnType;
    };
  }
}

export const DiffMarkExtension = Mark.create<DiffMarkOptions>({
  name: 'diffMark',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addExtensions() {
    return [InsertionMark, DeletionMark];
  },

  addCommands() {
    return {
      setInsertion:
        () =>
        ({ commands }) => {
          return commands.setMark('insertion');
        },
      setDeletion:
        () =>
        ({ commands }) => {
          return commands.setMark('deletion');
        },
      clearDiffMarks:
        () =>
        ({ commands }) => {
          return (
            commands.unsetMark('insertion') && commands.unsetMark('deletion')
          );
        },
      acceptDiff:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false;

          const { doc } = state;

          // 삭제 마크가 있는 노드 찾아서 제거
          doc.descendants((node, pos) => {
            if (node.marks.some((mark) => mark.type.name === 'deletion')) {
              tr.delete(pos, pos + node.nodeSize);
            }
          });

          // 삽입 마크 제거 (텍스트는 유지)
          tr.removeMark(0, doc.content.size, state.schema.marks.insertion);

          dispatch(tr);
          return true;
        },
      rejectDiff:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false;

          const { doc } = state;

          // 삽입 마크가 있는 노드 찾아서 제거
          doc.descendants((node, pos) => {
            if (node.marks.some((mark) => mark.type.name === 'insertion')) {
              tr.delete(pos, pos + node.nodeSize);
            }
          });

          // 삭제 마크 제거 (텍스트는 유지 - 복원)
          tr.removeMark(0, doc.content.size, state.schema.marks.deletion);

          dispatch(tr);
          return true;
        },
    };
  },
});

