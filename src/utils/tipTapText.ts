/**
 * TipTap JSON에서 plain text를 추출하는 유틸리티
 * - HTML 정규식 기반 stripHtml보다 성능이 우수함
 * - TipTap의 generateText를 사용하여 구조 인식 변환
 */

import { generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import type { TipTapDocJson } from '@/ai/translateDocument';

/**
 * generateText에 필요한 TipTap extensions
 * - TipTapEditor.tsx와 동일한 extension 구성 사용
 */
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  Link.configure({ openOnClick: false }),
];

/**
 * TipTap JSON을 plain text로 변환
 * - 헤딩, 리스트, 링크 등의 구조를 인식하여 자연스러운 텍스트 생성
 * - HTML 정규식 변환(stripHtml)보다 성능 우수
 *
 * @param docJson TipTap JSON 문서
 * @returns plain text 문자열, 변환 실패 시 빈 문자열
 */
export function extractTextFromTipTap(docJson: TipTapDocJson | null): string {
  if (!docJson) return '';

  try {
    return generateText(docJson, extensions);
  } catch (err) {
    console.error('[tipTapText] Failed to generate text from docJson:', err);
    return '';
  }
}

/**
 * TipTap JSON에서 텍스트 추출 후 최대 길이로 자르기
 * - 전체 문서를 먼저 변환하지 않고, 필요한 만큼만 처리
 * - 대용량 문서에서 성능 이점
 *
 * @param docJson TipTap JSON 문서
 * @param maxChars 최대 문자 수
 * @returns 잘린 plain text
 */
export function extractTextWithLimit(
  docJson: TipTapDocJson | null,
  maxChars: number,
): string {
  const text = extractTextFromTipTap(docJson);
  if (text.length <= maxChars) return text;

  // head+tail 방식으로 앞뒤 맥락 확보 (reviewTool과 동일 로직)
  const marker = '\n...\n';
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.floor(budget * 0.62);
  const tailLen = Math.max(0, budget - headLen);
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(Math.max(0, text.length - tailLen)) : '';
  return `${head}${marker}${tail}`;
}
