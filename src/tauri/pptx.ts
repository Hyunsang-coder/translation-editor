// Rust pptx 커맨드의 TypeScript 래퍼

import { invoke } from './invoke';

export interface SlideText {
  slide_index: number;
  texts: string[];
}

export interface ExtractedPptx {
  file_name: string;
  slides: SlideText[];
}

/**
 * PPTX 파일에서 슬라이드별 텍스트 추출
 * @param path PPTX 파일 경로
 * @returns 추출된 텍스트 정보
 */
export async function extractPptxTexts(path: string): Promise<ExtractedPptx> {
  return invoke<ExtractedPptx>('extract_pptx_texts', { path });
}

/**
 * 번역된 텍스트로 새 PPTX 생성
 * @param sourcePath 원본 PPTX 파일 경로
 * @param outputPath 출력 PPTX 파일 경로
 * @param translations 슬라이드별 번역된 텍스트
 */
export async function writeTranslatedPptx(
  sourcePath: string,
  outputPath: string,
  translations: SlideText[]
): Promise<void> {
  return invoke('write_translated_pptx', {
    sourcePath,
    outputPath,
    translations,
  });
}
