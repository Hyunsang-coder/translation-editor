/**
 * TranslationBlock Extension
 * 번역 블록을 위한 TipTap 커스텀 노드 확장
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface TranslationBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    translationBlock: {
      /**
       * 번역 블록 설정
       */
      setTranslationBlock: () => ReturnType;
      /**
       * 블록 분할
       */
      splitTranslationBlock: () => ReturnType;
    };
  }
}

export const TranslationBlockExtension = Node.create<TranslationBlockOptions>({
  name: 'translationBlock',

  group: 'block',

  content: 'inline*',

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => {
          if (!attributes.blockId) {
            return {};
          }
          return { 'data-block-id': attributes.blockId as string };
        },
      },
      blockType: {
        default: 'target',
        parseHTML: (element) => element.getAttribute('data-block-type'),
        renderHTML: (attributes) => {
          return { 'data-block-type': attributes.blockType as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-translation-block]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-translation-block': '',
        class: 'translation-block',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setTranslationBlock:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
      splitTranslationBlock:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { $from } = selection;

          if (!dispatch) {
            return false;
          }

          // 현재 커서 위치에서 블록 분할
          const pos = $from.pos;
          const node = $from.parent;

          if (node.type.name !== this.name) {
            return false;
          }

          // 분할 로직은 프론트엔드 스토어에서 처리
          // 여기서는 기본 split 동작만 수행
          tr.split(pos);
          dispatch(tr);

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        // Enter 키 입력 시 블록 분할
        return editor.commands.splitTranslationBlock();
      },
    };
  },
});

