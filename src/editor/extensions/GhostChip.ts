/**
 * GhostChip Extension
 * 변수 및 태그를 편집 불가능한 배지 형태로 표시하는 인라인 노드 확장
 * {user}, {name}, <br> 등의 변수를 보호
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface GhostChipOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostChip: {
      /**
       * Ghost Chip 삽입
       */
      insertGhostChip: (options: { value: string }) => ReturnType;
    };
  }
}

export const GhostChipExtension = Node.create<GhostChipOptions>({
  name: 'ghostChip',

  group: 'inline',

  inline: true,

  atom: true, // 편집 불가능한 원자 노드

  selectable: false,

  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      value: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-value'),
        renderHTML: (attributes) => {
          return { 'data-value': attributes.value as string };
        },
      },
      chipType: {
        default: 'variable', // 'variable' | 'tag' | 'newline'
        parseHTML: (element) => element.getAttribute('data-chip-type'),
        renderHTML: (attributes) => {
          return { 'data-chip-type': attributes.chipType as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ghost-chip]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = node.attrs.value as string;

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-ghost-chip': '',
        class: 'ghost-chip',
        contenteditable: 'false',
      }),
      value,
    ];
  },

  addCommands() {
    return {
      insertGhostChip:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              value: options.value,
              chipType: detectChipType(options.value),
            },
          });
        },
    };
  },
});

/**
 * 값에 따른 칩 타입 감지
 */
function detectChipType(value: string): string {
  if (value === '\\n' || value === '<br>' || value === '<br/>') {
    return 'newline';
  }
  if (value.startsWith('<') && value.endsWith('>')) {
    return 'tag';
  }
  return 'variable';
}

