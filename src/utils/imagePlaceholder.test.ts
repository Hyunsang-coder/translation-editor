import { describe, it, expect } from 'vitest';
import {
  extractImages,
  restoreImages,
  getImageInfo,
  estimateTokenSavings,
} from './imagePlaceholder';

describe('extractImages', () => {
  it('단일 이미지 추출', () => {
    const markdown = '# Title\n![alt text](https://example.com/image.png)';
    const { sanitized, imageMap } = extractImages(markdown);

    expect(sanitized).toBe('# Title\n![alt text](IMAGE_PLACEHOLDER_0)');
    expect(imageMap.size).toBe(1);
    expect(imageMap.get('IMAGE_PLACEHOLDER_0')).toBe('https://example.com/image.png');
  });

  it('여러 이미지 추출', () => {
    const markdown = '![a](url1)\n![b](url2)\n![c](url3)';
    const { sanitized, imageMap } = extractImages(markdown);

    expect(sanitized).toBe('![a](IMAGE_PLACEHOLDER_0)\n![b](IMAGE_PLACEHOLDER_1)\n![c](IMAGE_PLACEHOLDER_2)');
    expect(imageMap.size).toBe(3);
  });

  it('Base64 이미지 추출', () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const markdown = `![photo](${base64})`;
    const { sanitized, imageMap } = extractImages(markdown);

    expect(sanitized).toBe('![photo](IMAGE_PLACEHOLDER_0)');
    expect(imageMap.get('IMAGE_PLACEHOLDER_0')).toBe(base64);
  });

  it('alt text 없는 이미지', () => {
    const markdown = '![](https://example.com/image.png)';
    const { sanitized, imageMap } = extractImages(markdown);

    expect(sanitized).toBe('![](IMAGE_PLACEHOLDER_0)');
    expect(imageMap.size).toBe(1);
  });

  it('이미지가 없는 경우', () => {
    const markdown = '# Title\nSome text without images.';
    const { sanitized, imageMap } = extractImages(markdown);

    expect(sanitized).toBe(markdown);
    expect(imageMap.size).toBe(0);
  });

  it('빈 문자열', () => {
    const { sanitized, imageMap } = extractImages('');

    expect(sanitized).toBe('');
    expect(imageMap.size).toBe(0);
  });

  it('특수 문자가 포함된 alt text', () => {
    const markdown = '![alt (with) [brackets]](https://example.com/image.png)';
    const { imageMap } = extractImages(markdown);

    // 현재 정규식 /!\[([^\]]*)\]\(([^)]+)\)/g 는 alt에 ]가 있으면 매칭 실패
    // 이는 알려진 한계점으로, 실제 사용에서는 드문 케이스
    expect(imageMap.size).toBe(0);
  });

  it('괄호가 포함된 alt text (대괄호 없음)', () => {
    const markdown = '![alt (with parens)](https://example.com/image.png)';
    const { imageMap } = extractImages(markdown);

    // 소괄호는 문제 없음
    expect(imageMap.size).toBe(1);
  });
});

describe('restoreImages', () => {
  it('단일 이미지 복원', () => {
    const sanitized = '# 제목\n![대체 텍스트](IMAGE_PLACEHOLDER_0)';
    const imageMap = new Map([['IMAGE_PLACEHOLDER_0', 'https://example.com/image.png']]);

    const restored = restoreImages(sanitized, imageMap);

    expect(restored).toBe('# 제목\n![대체 텍스트](https://example.com/image.png)');
  });

  it('여러 이미지 복원', () => {
    const sanitized = '![a](IMAGE_PLACEHOLDER_0)\n![b](IMAGE_PLACEHOLDER_1)';
    const imageMap = new Map([
      ['IMAGE_PLACEHOLDER_0', 'url1'],
      ['IMAGE_PLACEHOLDER_1', 'url2'],
    ]);

    const restored = restoreImages(sanitized, imageMap);

    expect(restored).toBe('![a](url1)\n![b](url2)');
  });

  it('Base64 이미지 복원', () => {
    const base64 = 'data:image/png;base64,ABC123==';
    const sanitized = '![photo](IMAGE_PLACEHOLDER_0)';
    const imageMap = new Map([['IMAGE_PLACEHOLDER_0', base64]]);

    const restored = restoreImages(sanitized, imageMap);

    expect(restored).toBe(`![photo](${base64})`);
  });

  it('빈 맵으로 복원 시도', () => {
    const sanitized = '![alt](IMAGE_PLACEHOLDER_0)';
    const imageMap = new Map<string, string>();

    const restored = restoreImages(sanitized, imageMap);

    // 매칭되는 플레이스홀더가 없으면 그대로 유지
    expect(restored).toBe(sanitized);
  });

  it('왕복 테스트 (extract → restore)', () => {
    const original = '# Title\n![img1](https://example.com/1.png)\nText\n![img2](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)';

    const { sanitized, imageMap } = extractImages(original);
    const restored = restoreImages(sanitized, imageMap);

    expect(restored).toBe(original);
  });
});

describe('getImageInfo', () => {
  it('이미지 정보 추출', () => {
    const markdown = '![alt](https://example.com/image.png)';
    const info = getImageInfo(markdown);

    expect(info).toHaveLength(1);
    expect(info[0]?.alt).toBe('alt');
    expect(info[0]?.url).toBe('https://example.com/image.png');
    expect(info[0]?.isBase64).toBe(false);
    expect(info[0]?.size).toBe('https://example.com/image.png'.length);
  });

  it('Base64 이미지 감지', () => {
    const markdown = '![photo](data:image/png;base64,ABC123)';
    const info = getImageInfo(markdown);

    expect(info).toHaveLength(1);
    expect(info[0]?.isBase64).toBe(true);
  });

  it('여러 이미지 정보', () => {
    const markdown = '![a](url1)\n![b](data:image/jpeg;base64,XYZ)\n![c](url3)';
    const info = getImageInfo(markdown);

    expect(info).toHaveLength(3);
    expect(info[0]?.isBase64).toBe(false);
    expect(info[1]?.isBase64).toBe(true);
    expect(info[2]?.isBase64).toBe(false);
  });

  it('이미지 없는 경우', () => {
    const info = getImageInfo('No images here');
    expect(info).toHaveLength(0);
  });
});

describe('estimateTokenSavings', () => {
  it('토큰 절약량 계산', () => {
    const imageMap = new Map([
      ['IMAGE_PLACEHOLDER_0', 'data:image/png;base64,' + 'A'.repeat(10000)],
    ]);

    const savings = estimateTokenSavings(imageMap);

    // 원본: ~10000/3 = 3333 토큰
    // 플레이스홀더: ~20/3 = 7 토큰
    // 절약: ~3326 토큰
    expect(savings).toBeGreaterThan(3000);
  });

  it('여러 이미지의 총 절약량', () => {
    const imageMap = new Map([
      ['IMAGE_PLACEHOLDER_0', 'A'.repeat(3000)],
      ['IMAGE_PLACEHOLDER_1', 'B'.repeat(3000)],
    ]);

    const savings = estimateTokenSavings(imageMap);

    // 총 6000자 / 3 = 2000 토큰 (원본)
    // 플레이스홀더 ~40자 / 3 = 14 토큰
    expect(savings).toBeGreaterThan(1900);
  });

  it('빈 맵', () => {
    const savings = estimateTokenSavings(new Map());
    expect(savings).toBe(0);
  });

  it('짧은 URL은 절약량이 적음', () => {
    const imageMap = new Map([
      ['IMAGE_PLACEHOLDER_0', 'http://a.co/1.png'], // 18자
    ]);

    const savings = estimateTokenSavings(imageMap);

    // 원본 18자 = 6토큰, 플레이스홀더 20자 = 7토큰
    // 실제로는 음수가 될 수 있지만 Math.max(0, ...) 처리
    expect(savings).toBeGreaterThanOrEqual(0);
  });
});
