import { describe, expect, it } from 'vitest';
import { stripHtml } from './hash';

describe('stripHtml', () => {
  it('일반 HTML 태그를 제거하고 텍스트만 남긴다', () => {
    expect(stripHtml('<p>문서의 <a href="https://example.com">부록</a>입니다.</p>'))
      .toBe('문서의 부록입니다.');
  });

  it('HTML 엔티티로 인코딩된 태그도 제거한다', () => {
    const encoded =
      '문서의 &lt;a target=&quot;_blank&quot; href=&quot;https://example.com&quot;&gt;부록&lt;/a&gt;입니다.';

    expect(stripHtml(encoded)).toBe('문서의 부록입니다.');
  });

  it('이중 인코딩된 HTML 태그도 제거한다', () => {
    const doubleEncoded =
      '문서의 &amp;lt;strong&amp;gt;중요한&amp;lt;/strong&amp;gt; 부분입니다.';

    expect(stripHtml(doubleEncoded)).toBe('문서의 중요한 부분입니다.');
  });
});
