/**
 * TipTap JSON <-> Markdown 변환 유틸리티
 *
 * tiptap-markdown 패키지를 사용하여 헤드리스 에디터 인스턴스로 변환을 수행합니다.
 * 번역 파이프라인에서 토큰 효율성을 위해 Markdown을 중간 형식으로 사용합니다.
 */

import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';

/**
 * TipTap 문서 JSON 타입
 * Record<string, unknown>과의 호환성을 위해 제네릭하게 정의
 * 런타임에서 type: 'doc'과 content 배열 존재 여부로 검증
 */
export type TipTapDocJson = Record<string, unknown>;

/**
 * 헤드리스 에디터용 공통 extension 구성
 * 에디터 UI와 동일한 extension을 사용하여 변환 일관성 보장
 */
function getExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6],
      },
    }),
    Link.configure({
      openOnClick: false,
    }),
    Table.configure({ resizable: false }), // 헤드리스에서는 리사이즈 불필요
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      html: false,                  // HTML 태그 비활성화
      tightLists: true,             // 리스트 항목 사이 빈 줄 제거
      tightListClass: 'tight',      // 타이트 리스트 클래스
      bulletListMarker: '-',        // 불릿 리스트 마커
      linkify: false,               // URL 자동 링크 비활성화
      breaks: false,                // 줄바꿈 처리
      transformPastedText: false,   // 붙여넣기 시 변환 비활성화
      transformCopiedText: false,   // 복사 시 변환 비활성화
    }),
  ];
}

/**
 * TipTap JSON -> Markdown 변환
 *
 * @param json - TipTap document JSON
 * @returns Markdown 문자열
 */
export function tipTapJsonToMarkdown(json: TipTapDocJson): string {
  const editor = new Editor({
    extensions: getExtensions(),
    content: json as Content,
  });

  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();

  return markdown;
}

/**
 * Markdown -> TipTap JSON 변환
 *
 * setContent를 사용하여 명시적 Markdown 파싱을 보장합니다.
 *
 * @param markdown - Markdown 문자열
 * @returns TipTap document JSON
 */
export function markdownToTipTapJson(markdown: string): TipTapDocJson {
  const editor = new Editor({
    extensions: getExtensions(),
  });

  // 명시적 Markdown 파싱
  editor.commands.setContent(markdown);

  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();

  return json;
}

/**
 * TipTap JSON이 유효한지 검증
 */
export function isValidTipTapDocJson(v: unknown): v is TipTapDocJson {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return obj.type === 'doc' && Array.isArray(obj.content);
}

/**
 * Markdown 텍스트의 토큰 수 추정
 * JSON 구조 오버헤드가 없으므로 순수 텍스트 기준으로 계산
 *
 * @param text - Markdown 텍스트
 * @returns 추정 토큰 수
 */
export function estimateMarkdownTokens(text: string): number {
  const chars = text.length;
  // 평균적으로 3자당 1토큰으로 추정 (한영 혼용 고려)
  // Markdown은 JSON 오버헤드가 없으므로 추가 계수 없음
  return Math.ceil(chars / 3);
}

/**
 * Markdown 응답의 truncation 감지
 *
 * @param markdown - Markdown 텍스트
 * @returns truncation 감지 결과
 */
export function detectMarkdownTruncation(markdown: string): { isTruncated: boolean; reason?: string } {
  // 열린 코드 블록 체크 (```가 홀수개)
  const codeBlockCount = (markdown.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    return { isTruncated: true, reason: `Unclosed code block: ${codeBlockCount} markers` };
  }

  // 미완성 리스트 아이템 체크 (줄 끝에 - 만 있는 경우)
  if (/\n-\s*$/.test(markdown)) {
    return { isTruncated: true, reason: 'Incomplete list item at end' };
  }

  // 미완성 heading 체크 (줄 끝에 # 만 있는 경우)
  if (/\n#{1,6}\s*$/.test(markdown)) {
    return { isTruncated: true, reason: 'Incomplete heading at end' };
  }

  // 미완성 링크 체크
  const openBrackets = (markdown.match(/\[/g) || []).length;
  const closeBrackets = (markdown.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    return { isTruncated: true, reason: `Unclosed brackets: ${openBrackets} open, ${closeBrackets} close` };
  }

  return { isTruncated: false };
}

/**
 * 번역 응답에서 Markdown 추출 (구분자 사용)
 *
 * @param response - LLM 응답 텍스트
 * @returns 추출된 Markdown
 */
export function extractTranslationMarkdown(response: string): string {
  const startMarker = '---TRANSLATION_START---';
  const endMarker = '---TRANSLATION_END---';

  const startIdx = response.indexOf(startMarker);
  const endIdx = response.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return response.slice(startIdx + startMarker.length, endIdx).trim();
  }

  // Fallback: 구분자 없으면 전체 응답 사용 (경고 로그)
  console.warn('[Translation] No markers found, using raw response');
  return response.trim();
}
