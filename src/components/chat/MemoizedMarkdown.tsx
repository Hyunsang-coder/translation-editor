import { memo, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 렌더링에 사용되는 커스텀 컴포넌트들
 * 메모이제이션을 위해 컴포넌트 외부에 정의
 */
const markdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a: ({ node: _node, ...props }: any) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer noopener"
      className="underline break-all text-primary-500 hover:text-primary-600"
    />
  ),
};

interface MemoizedMarkdownProps {
  content: string;
}

/**
 * 메모이제이션된 Markdown 렌더링 컴포넌트
 *
 * content가 변경되지 않으면 ReactMarkdown 파싱을 다시 수행하지 않습니다.
 * 이는 채팅 목록 전체가 리렌더링될 때 성능을 크게 개선합니다.
 */
export const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
}: MemoizedMarkdownProps) {
  // content가 변경될 때만 cleanedContent 재계산
  const cleanedContent = useMemo(() => {
    if (!content) return '';
    return content
      // 1. "cite" 또는 "turnXsearchY" 패턴과 주변의 PUA(Private Use Area) 문자 제거
      .replace(/([\uE000-\uF8FF]*(?:cite|turn\d+search\d+)[\uE000-\uF8FF]*)+/g, '')
      // 2. 남은 PUA 문자 제거 (안전장치)
      .replace(/[\uE000-\uF8FF]/g, '');
  }, [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={defaultUrlTransform}
      components={markdownComponents}
    >
      {cleanedContent}
    </ReactMarkdown>
  );
});
