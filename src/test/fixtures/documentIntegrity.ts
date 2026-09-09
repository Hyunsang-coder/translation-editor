import type { TipTapDocJson } from '@/utils/markdownConverter';

export function createFormatIntegritySourceDoc(): TipTapDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Deployment Checklist' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Open ' },
          { type: 'text', text: 'Inventory', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' in the ' },
          {
            type: 'text',
            text: 'dashboard',
            marks: [{
              type: 'link',
              attrs: {
                href: 'https://example.com/dashboard',
                target: null,
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
            }],
          },
          {
            type: 'text',
            text: ' with {playerName} on 2026-09-09.',
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'Press Ctrl+Shift+P.' }],
            }],
          },
          {
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'Keep the message placeholder %s.' }],
            }],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 2, rowspan: 1, colwidth: [180, 220] },
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Runtime configuration' }],
                }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Retry count' }],
                  },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [{
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Maximum: 3' }],
                        }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: [220] },
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'API version v3.14.1' }],
                }],
              },
            ],
          },
        ],
      },
      {
        type: 'image',
        attrs: {
          src: 'https://example.com/deployment-diagram.png',
          alt: 'deployment diagram',
          title: 'Deployment architecture',
          width: 640,
          height: 360,
        },
      },
      {
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [{ type: 'text', text: '{"maxRetries": 3}' }],
      },
    ],
  };
}
