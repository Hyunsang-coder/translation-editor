/**
 * ImagePlaceholder Extension
 * 이미지를 실제 로딩하지 않고 placeholder로 표시
 * - 네트워크 요청 방지 (failed to load resource 에러 제거)
 * - 에디터 성능 향상
 * - 이미지 데이터(src)는 JSON에 그대로 보존
 */

import Image from '@tiptap/extension-image';

export interface ImagePlaceholderOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
}

export const ImagePlaceholder = Image.extend<ImagePlaceholderOptions>({
  name: 'image',

  renderHTML({ HTMLAttributes }) {
    // 실제 이미지 대신 placeholder div 렌더링
    // src 속성은 data-src로 보존하여 필요시 복원 가능
    const src = HTMLAttributes.src as string | undefined;
    const alt = HTMLAttributes.alt as string | undefined;

    return [
      'div',
      {
        class: 'image-placeholder',
        'data-src': src || '',
        'data-alt': alt || '',
        'data-type': 'image',
        contenteditable: 'false',
      },
      [
        'span',
        { class: 'image-placeholder-icon' },
        '🖼️',
      ],
      [
        'span',
        { class: 'image-placeholder-label' },
        '[Image]',
      ],
    ];
  },

  parseHTML() {
    return [
      // 기존 img 태그 파싱
      {
        tag: 'img[src]',
      },
      // placeholder div도 파싱 (재로드 시)
      {
        tag: 'div[data-type="image"]',
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const element = node as HTMLElement;
          return {
            src: element.getAttribute('data-src'),
            alt: element.getAttribute('data-alt'),
          };
        },
      },
    ];
  },

  // getHTML() 호출 시 원본 img 태그로 출력 (내보내기용)
  addStorage() {
    return {
      // 원본 이미지 태그를 얻기 위한 helper
      getOriginalHTML: (src: string, alt?: string) => {
        return `<img src="${src}"${alt ? ` alt="${alt}"` : ''}>`;
      },
    };
  },
});
