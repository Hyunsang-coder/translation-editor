/**
 * 이미지 리사이즈 유틸리티
 * - Canvas API를 사용하여 큰 이미지를 API 제한에 맞게 축소
 * - Anthropic: 5MB 제한, OpenAI: 20MB 제한
 */

/** 리사이즈 설정 */
export interface ResizeOptions {
  /** 긴 변 기준 최대 픽셀 (기본값: 2048) */
  maxDimension?: number;
  /** JPEG 품질 0-1 (기본값: 0.85) */
  quality?: number;
  /** 출력 포맷 (기본값: 'jpeg') */
  format?: 'jpeg' | 'png' | 'webp';
}

const DEFAULT_OPTIONS: Required<ResizeOptions> = {
  maxDimension: 2048,
  quality: 0.85,
  format: 'jpeg',
};

/**
 * Base64 data URL 이미지를 리사이즈하여 새 data URL 반환
 * @param dataUrl 원본 이미지 data URL
 * @param options 리사이즈 옵션
 * @returns 리사이즈된 이미지 data URL
 */
export async function resizeImageDataUrl(
  dataUrl: string,
  options?: ResizeOptions
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const { width, height } = img;

        // 리사이즈 필요 여부 확인
        const maxDim = Math.max(width, height);
        if (maxDim <= opts.maxDimension) {
          // 이미 충분히 작음 - 포맷 변환만 수행 (JPEG 압축 적용)
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context 생성 실패'));
            return;
          }
          ctx.drawImage(img, 0, 0);
          const result = canvas.toDataURL(`image/${opts.format}`, opts.quality);
          resolve(result);
          return;
        }

        // 비율 유지하며 리사이즈
        const scale = opts.maxDimension / maxDim;
        const newWidth = Math.round(width * scale);
        const newHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context 생성 실패'));
          return;
        }

        // 고품질 리사이즈 설정
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        const result = canvas.toDataURL(`image/${opts.format}`, opts.quality);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('이미지 로드 실패'));
    };

    img.src = dataUrl;
  });
}

/**
 * Data URL의 대략적인 바이트 크기 계산
 * @param dataUrl base64 data URL
 * @returns 바이트 크기 (추정치)
 */
export function estimateDataUrlSize(dataUrl: string): number {
  // data:image/jpeg;base64, 부분 제거 후 base64 길이로 계산
  const base64 = dataUrl.split(',')[1];
  if (!base64) return 0;
  // base64는 원본의 약 4/3 크기
  return Math.ceil((base64.length * 3) / 4);
}

/** API 제공자별 이미지 크기 제한 (바이트) */
export const IMAGE_SIZE_LIMITS = {
  anthropic: 5 * 1024 * 1024, // 5MB
  openai: 20 * 1024 * 1024, // 20MB
} as const;

/**
 * 이미지를 API 제한에 맞게 자동 리사이즈
 * - 크기 제한을 초과하면 점진적으로 품질/해상도를 낮춤
 * @param dataUrl 원본 이미지 data URL
 * @param maxBytes 최대 허용 바이트 (기본값: Anthropic 5MB)
 * @returns 리사이즈된 이미지 data URL
 */
export async function resizeImageForApi(
  dataUrl: string,
  maxBytes: number = IMAGE_SIZE_LIMITS.anthropic
): Promise<string> {
  // 1차: 기본 설정으로 리사이즈
  let result = await resizeImageDataUrl(dataUrl, {
    maxDimension: 2048,
    quality: 0.85,
    format: 'jpeg',
  });

  let size = estimateDataUrlSize(result);
  if (size <= maxBytes) return result;

  // 2차: 해상도 낮춤
  result = await resizeImageDataUrl(dataUrl, {
    maxDimension: 1536,
    quality: 0.80,
    format: 'jpeg',
  });

  size = estimateDataUrlSize(result);
  if (size <= maxBytes) return result;

  // 3차: 더 낮은 해상도
  result = await resizeImageDataUrl(dataUrl, {
    maxDimension: 1024,
    quality: 0.75,
    format: 'jpeg',
  });

  size = estimateDataUrlSize(result);
  if (size <= maxBytes) return result;

  // 4차: 최소 품질
  result = await resizeImageDataUrl(dataUrl, {
    maxDimension: 768,
    quality: 0.70,
    format: 'jpeg',
  });

  return result;
}
