import { describe, it, expect } from 'vitest';
import {
  tipTapJsonToMarkdown,
  tipTapJsonToMarkdownForTranslation,
} from './markdownConverter';
import type { TipTapDocJson } from './markdownConverter';

/**
 * CommentMark가 Markdown 변환 경로에서 schema 에러 없이 직렬화되고,
 * Markdown 출력에는 span/마크가 남지 않고 텍스트만 남는지(소실 허용) 검증.
 *
 * 실제 영속 경로(blocks.content HTML → 라이브 에디터 → JSON)에서 comment 마크가
 * 붙은 JSON이 들어왔을 때 AI Markdown으로 안전하게 평탄화되는지 확인한다.
 */
const docWithComment: TipTapDocJson = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'before ' },
        {
          type: 'text',
          text: 'marked text',
          marks: [{ type: 'comment', attrs: { commentId: 'cmt_1' } }],
        },
        { type: 'text', text: ' after' },
      ],
    },
  ],
};

describe('CommentMark Markdown 변환', () => {
  it('comment 마크가 붙은 JSON을 schema 에러 없이 직렬화한다 (기본)', () => {
    const md = tipTapJsonToMarkdown(docWithComment);
    expect(md).toContain('before');
    expect(md).toContain('marked text');
    expect(md).toContain('after');
    expect(md).not.toContain('data-comment-id');
    expect(md).not.toContain('comment-mark');
  });

  it('comment 마크가 붙은 JSON을 schema 에러 없이 직렬화한다 (번역 경로)', () => {
    const md = tipTapJsonToMarkdownForTranslation(docWithComment);
    expect(md).toContain('marked text');
    expect(md).not.toContain('data-comment-id');
    expect(md).not.toContain('comment-mark');
  });
});
