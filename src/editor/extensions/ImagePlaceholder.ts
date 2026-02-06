/**
 * ImagePlaceholder Extension
 * 이미지를 실제 로딩하지 않고 placeholder로 표시
 * - 네트워크 요청 방지 (failed to load resource 에러 제거)
 * - 에디터 성능 향상
 * - 이미지 데이터(src)는 JSON에 그대로 보존
 */

import Image from '@tiptap/extension-image';

/**
 * parseHTML 확장: placeholder div도 파싱 가능하도록
 * placeholder ↔ original 모드 전환 시 데이터 보존
 */
const extendedParseHTML = [
  { tag: 'img[src]' },
  {
    tag: 'img',
    getAttrs: (node: string | HTMLElement) => {
      if (typeof node === 'string') return false;
      return {
        src: node.getAttribute('src') || '',
        alt: node.getAttribute('alt') || '[Image]',
      };
    },
  },
  {
    tag: 'div[data-type="image"]',
    getAttrs: (node: string | HTMLElement) => {
      if (typeof node === 'string') return false;
      return {
        src: node.getAttribute('data-src'),
        alt: node.getAttribute('data-alt'),
      };
    },
  },
];

/**
 * Original 모드: 실제 <img> 태그 렌더링 (CDN 이미지 표시)
 * placeholder div도 파싱 가능 (모드 전환 시 데이터 보존)
 */
export const ImageOriginal = Image.extend({
  name: 'image',
  parseHTML() {
    return extendedParseHTML;
  },
});

/**
 * Placeholder 모드: div placeholder로 렌더링
 * src는 data-src로 보존
 */
export const ImagePlaceholder = Image.extend({
  name: 'image',

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src as string | undefined;
    const alt = HTMLAttributes.alt as string | undefined;

    const isVideo = alt === '[Video]';
    const isEmbed = alt === '[Embed]';
    const icon = isVideo ? '🎬' : isEmbed ? '📎' : '🖼️';
    const label = isVideo ? '[Video]' : isEmbed ? '[Embed]' : '[Image]';

    return [
      'div',
      {
        class: 'image-placeholder',
        'data-src': src || '',
        'data-alt': alt || '',
        'data-type': 'image',
        contenteditable: 'false',
      },
      ['span', { class: 'image-placeholder-icon' }, icon],
      ['span', { class: 'image-placeholder-label' }, label],
    ];
  },

  parseHTML() {
    return extendedParseHTML;
  },
});
