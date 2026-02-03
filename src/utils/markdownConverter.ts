/**
 * TipTap JSON <-> Markdown 변환 유틸리티
 *
 * tiptap-markdown 패키지를 사용하여 헤드리스 에디터 인스턴스로 변환을 수행합니다.
 * 번역 파이프라인에서 토큰 효율성을 위해 Markdown을 중간 형식으로 사용합니다.
 */

import { Editor, type Content, getHTMLFromFragment } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Markdown } from 'tiptap-markdown';

/**
 * TipTap 문서 JSON 타입
 * Record<string, unknown>과의 호환성을 위해 제네릭하게 정의
 * 런타임에서 type: 'doc'과 content 배열 존재 여부로 검증
 */
export type TipTapDocJson = Record<string, unknown>;

/**
 * 헤드리스 에디터용 공통 extension 구성
 * 에디터 UI(TipTapEditor.tsx)와 동일한 extension을 사용하여 변환 일관성 보장
 *
 * 주의: TipTapEditor.tsx의 extension 목록과 동기화 필요
 */

// Extension 캐시 (성능 최적화: 매번 새로 생성하지 않음)
let cachedExtensions: ReturnType<typeof createExtensions> | null = null;
let cachedExtensionsForTranslation: ReturnType<typeof createExtensionsForTranslation> | null = null;

/**
 * 기본 Extension 생성 (html: false)
 * Chat, Review, 에디터 등 일반적인 용도
 */
function createExtensions() {
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
    Image.configure({
      inline: false,
      allowBase64: true,
    }),
    // TipTapEditor.tsx와 동일한 mark extensions (Markdown 변환 시 손실되지만 JSON 파싱에 필요)
    Underline,
    Highlight.configure({ multicolor: false }),
    Subscript,
    Superscript,
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
 * 테이블을 항상 HTML로 변환하는 커스텀 Table Extension
 *
 * tiptap-markdown의 기본 Table은 isMarkdownSerializable() 조건을 만족하면
 * Markdown 테이블로 변환하지만, 셀 내 리스트가 있으면 줄바꿈 텍스트로 평탄화되어
 * Markdown 테이블 구문이 깨집니다.
 *
 * 이 확장은 모든 테이블을 HTML로 변환하여 구조를 완벽하게 보존합니다.
 */
const TableForTranslation = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: {
          write: (s: string) => void;
          closeBlock: (node: unknown) => void;
        }, node: unknown) {
          // 항상 HTML로 변환 (isMarkdownSerializable 체크 건너뜀)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const typedNode = node as any;
          const html = getHTMLFromFragment(
            Fragment.from(typedNode),
            typedNode.type.schema
          );
          state.write(html);
          if (typedNode.isBlock) {
            state.closeBlock(node);
          }
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

/**
 * 번역 전용 Extension 생성 (html: true + 테이블 항상 HTML)
 *
 * 복잡한 테이블(셀 내 리스트, 다중 paragraph 등)을 HTML로 변환/파싱하기 위해
 * html: true 옵션과 커스텀 Table extension을 사용합니다.
 *
 * 주의: 이 Extension은 번역 파이프라인(translateDocument.ts)에서만 사용해야 합니다.
 * 다른 곳에서 사용하면 의도치 않은 HTML 출력이 발생할 수 있습니다.
 */
function createExtensionsForTranslation() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6],
      },
    }),
    Link.configure({
      openOnClick: false,
    }),
    TableForTranslation.configure({ resizable: false }), // 항상 HTML로 변환하는 커스텀 Table
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({
      inline: false,
      allowBase64: true,
    }),
    Underline,
    Highlight.configure({ multicolor: false }),
    Subscript,
    Superscript,
    Markdown.configure({
      html: true,                   // HTML 태그 활성화 (테이블 지원)
      tightLists: true,
      tightListClass: 'tight',
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: false,
      transformCopiedText: false,
    }),
  ];
}

function getExtensions() {
  if (!cachedExtensions) {
    cachedExtensions = createExtensions();
  }
  return cachedExtensions;
}

function getExtensionsForTranslation() {
  if (!cachedExtensionsForTranslation) {
    cachedExtensionsForTranslation = createExtensionsForTranslation();
  }
  return cachedExtensionsForTranslation;
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

// ============================================================
// 번역 전용 함수 (html: true - 복잡한 테이블 지원)
// ============================================================

/**
 * TipTap JSON -> Markdown 변환 (번역 전용)
 *
 * 복잡한 테이블(셀 내 리스트, 다중 paragraph)을 HTML로 변환합니다.
 * tiptap-markdown의 isMarkdownSerializable() 조건을 만족하지 않는 테이블도
 * HTML 형식으로 출력되어 LLM이 번역할 수 있습니다.
 *
 * 주의: translateDocument.ts에서만 사용. 다른 곳에서는 tipTapJsonToMarkdown() 사용.
 *
 * @param json - TipTap document JSON
 * @returns Markdown + HTML 혼합 문자열
 */
export function tipTapJsonToMarkdownForTranslation(json: TipTapDocJson): string {
  const editor = new Editor({
    extensions: getExtensionsForTranslation(),
    content: json as Content,
  });

  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();

  return markdown;
}

/**
 * Markdown (+ HTML) -> TipTap JSON 변환 (번역 전용)
 *
 * LLM이 반환한 HTML 테이블을 TipTap JSON으로 파싱합니다.
 * html: true 설정으로 HTML 테이블이 올바르게 파싱됩니다.
 *
 * 주의: translateDocument.ts에서만 사용. 다른 곳에서는 markdownToTipTapJson() 사용.
 *
 * @param markdown - Markdown + HTML 혼합 문자열
 * @returns TipTap document JSON
 */
export function markdownToTipTapJsonForTranslation(markdown: string): TipTapDocJson {
  // 전처리: --- 를 수평선으로 인식하려면 앞뒤에 빈 줄이 필요함
  // AI 응답에서 빈 줄이 누락될 수 있으므로 정규화
  const normalized = normalizeHorizontalRules(markdown);

  const editor = new Editor({
    extensions: getExtensionsForTranslation(),
  });

  editor.commands.setContent(normalized);

  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();

  return json;
}

/**
 * Markdown의 --- (horizontal rule)를 정규화
 *
 * Markdown에서 ---가 수평선으로 파싱되려면 앞뒤에 빈 줄이 필요합니다.
 * AI 번역 결과에서 빈 줄이 누락되는 경우가 있어 전처리로 보정합니다.
 *
 * @param markdown - 원본 Markdown
 * @returns 정규화된 Markdown
 */
function normalizeHorizontalRules(markdown: string): string {
  // 1단계: 이미지 뒤에 바로 붙은 --- 분리
  // 예: "![](url)---" → "![](url)\n\n---"
  // 예: "![alt](url)---" → "![alt](url)\n\n---"
  let normalized = markdown.replace(
    /(\!\[[^\]]*\]\([^)]*\))[\s]*([-*_]{3,})/g,
    '$1\n\n$2'
  );

  // 2단계: --- 앞뒤에 빈 줄 보장
  // 패턴: 줄 시작 + optional 공백 + --- + optional 공백 + 줄 끝
  // 단, 코드 블록 내부는 제외해야 함

  const lines = normalized.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // 코드 블록 토글
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    // 코드 블록 내부면 그대로 유지
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // --- 또는 *** 또는 ___ (horizontal rule 패턴)
    if (/^[\s]*[-*_]{3,}[\s]*$/.test(line)) {
      // 앞에 빈 줄이 없으면 추가
      const lastLine = result[result.length - 1];
      if (result.length > 0 && lastLine !== undefined && lastLine.trim() !== '') {
        result.push('');
      }
      result.push(line);
      // 뒤에 빈 줄이 없으면 추가 (다음 줄 확인)
      const nextLine = lines[i + 1];
      if (i + 1 < lines.length && nextLine !== undefined && nextLine.trim() !== '') {
        result.push('');
      }
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
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
  const totalChars = text.length;
  if (totalChars === 0) return 0;

  // CJK 문자 (한중일) 카운트 - 토큰 비율이 다름
  const cjkPattern = /[\u4e00-\u9fff\uac00-\ud7af\u3040-\u30ff\u3100-\u312f]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkChars = cjkMatches ? cjkMatches.length : 0;
  const nonCjkChars = totalChars - cjkChars;

  // 영어: ~4자당 1토큰, 한국어/CJK: ~1.2자당 1토큰
  const cjkTokens = cjkChars / 1.2;
  const nonCjkTokens = nonCjkChars / 4;

  return Math.ceil(cjkTokens + nonCjkTokens);
}

/**
 * Markdown 응답의 truncation 감지
 *
 * 주의: 이 함수는 실제로 응답이 잘린 경우만 감지해야 합니다.
 * 정상적인 Markdown에서 오탐(false positive)이 발생하지 않도록 보수적으로 판단합니다.
 *
 * @param markdown - Markdown 텍스트
 * @returns truncation 감지 결과
 */
export function detectMarkdownTruncation(markdown: string): { isTruncated: boolean; reason?: string } {
  // 빈 응답은 truncation이 아님 (별도 검증에서 처리)
  if (!markdown || markdown.trim().length === 0) {
    return { isTruncated: false };
  }

  // 열린 코드 블록 체크 (```가 홀수개)
  // 코드 블록이 열려있으면 명확한 truncation
  const codeBlockCount = (markdown.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    return { isTruncated: true, reason: `Unclosed code block: ${codeBlockCount} markers` };
  }

  // 문서 끝이 불완전한 경우만 체크 (마지막 50자 검사)
  const tail = markdown.slice(-50);

  // 미완성 링크/이미지 체크: 문서 끝에 열린 bracket이 있는 경우만
  // 예: "자세한 내용은 [여기" 또는 "![이미지"
  if (/\[[^\]]*$/.test(tail)) {
    return { isTruncated: true, reason: 'Incomplete link/image at end' };
  }

  // 미완성 링크 URL 체크: ](까지 있지만 )가 없는 경우
  // 예: "[링크](https://exam"
  if (/\]\([^)]*$/.test(tail)) {
    return { isTruncated: true, reason: 'Incomplete link URL at end' };
  }

  return { isTruncated: false };
}

/**
 * HTML 문자열 -> Markdown 변환
 *
 * 세그먼트 검수 등에서 블록의 HTML content를 Markdown으로 변환할 때 사용합니다.
 * TipTap 에디터의 HTML 출력을 Markdown으로 변환합니다.
 *
 * @param html - HTML 문자열
 * @returns Markdown 문자열
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';

  // HTML을 TipTap 에디터로 로드 후 Markdown으로 변환
  const editor = new Editor({
    extensions: getExtensions(),
    content: html, // HTML string을 직접 content로 전달
  });

  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();

  return markdown;
}

/**
 * Markdown 문자열 -> HTML 변환
 *
 * 검수 결과 적용 등에서 Markdown을 HTML로 변환할 때 사용합니다.
 *
 * @param markdown - Markdown 문자열
 * @returns HTML 문자열
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';

  const json = markdownToTipTapJson(markdown);
  const editor = new Editor({
    extensions: getExtensions(),
    content: json,
  });

  const html = editor.getHTML();
  editor.destroy();

  return html;
}

/**
 * HTML 문자열 -> TipTap JSON 변환
 *
 * 프로젝트 로드 시 HTML 문서를 TipTap JSON으로 변환하여 저장합니다.
 * 이를 통해 에디터 마운트 여부와 관계없이 AI 도구가 문서에 접근할 수 있습니다.
 *
 * @param html - HTML 문자열
 * @returns TipTap document JSON (빈 문서일 경우 기본 doc 구조 반환)
 */
export function htmlToTipTapJson(html: string): TipTapDocJson {
  // 빈 HTML이면 기본 빈 문서 구조 반환
  if (!html || !html.trim()) {
    return { type: 'doc', content: [] };
  }

  const editor = new Editor({
    extensions: getExtensions(),
    content: html, // HTML string을 직접 content로 전달
  });

  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();

  return json;
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

/**
 * TipTap JSON을 HTML로 변환
 *
 * @param docJson - TipTap JSON 문서
 * @returns HTML 문자열
 */
export function tipTapJsonToHtml(docJson: TipTapDocJson): string {
  const extensions = getExtensionsForTranslation();
  const editor = new Editor({
    extensions,
    content: docJson as Content,
    editable: false,
  });

  const html = editor.getHTML();
  editor.destroy();
  return html;
}
