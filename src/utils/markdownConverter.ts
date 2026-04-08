/**
 * TipTap JSON <-> Markdown 변환 유틸리티
 *
 * tiptap-markdown 패키지를 사용하여 헤드리스 에디터 인스턴스로 변환을 수행합니다.
 * 번역 파이프라인에서 토큰 효율성을 위해 Markdown을 중간 형식으로 사용합니다.
 */

import { Editor, type Content, getHTMLFromFragment } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment } from '@tiptap/pm/model';
import DOMPurify from 'dompurify';
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
      autolink: false,
      linkOnPaste: false,
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
      autolink: false,
      linkOnPaste: false,
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

  return normalizeMarkdownWhitespace(markdown);
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

  return normalizeMarkdownWhitespace(markdown);
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
  const normalized = markdown.replace(
    /(!\[[^\]]*\]\([^)]*\))\s*([-*_]{3,})/g,
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
 * 인라인 마크 앞뒤의 다중 공백을 단일 공백으로 정규화
 *
 * prosemirror-markdown의 expelEnclosingWhitespace와 tiptap-markdown의
 * trimInline()/shiftDelim() 상호작용으로 마크 앞뒤에 여분 공백이 삽입되는 문제를 후처리.
 * 예: "move  **bold**" → "move **bold**"
 *
 * 코드 블록(```) 내부는 건드리지 않음.
 */
export function normalizeMarkdownWhitespace(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // 인라인 마크 앞의 다중 공백 → 단일 공백
    // 대상: **, ~~, *, ` (** 와 ~~ 를 먼저 매칭하여 *보다 우선)
    let normalized = line.replace(/ {2,}(\*\*|~~|\*|`)/g, ' $1');

    // 인라인 마크 뒤의 다중 공백 → 단일 공백
    // 닫는 마크 뒤 다중 공백: **text**  word → **text** word
    normalized = normalized.replace(/(\*\*|~~|\*|`) {2,}/g, '$1 ');

    result.push(normalized);
  }

  return result.join('\n');
}

/**
 * LLM 번역 결과에서 볼드 마크(**) 경계가 단어 중간에서 끊기는 문제를 보정
 *
 * LLM이 토큰 단위로 출력하면서 ** 마커가 단어 경계와 어긋나는 경우 발생.
 * 예: **Two typ**es → **Two types**
 *
 * 처리 패턴:
 * 1. **partial**rest → **partial rest** (닫는 ** 뒤 이어지는 단어문자를 mark 안으로)
 * 2. prefix**partial** → **prefix partial** (여는 ** 앞 이어지는 단어문자를 mark 안으로)
 * 3. ** text ** → **text** (mark 안 앞뒤 공백을 mark 밖으로)
 *
 * 코드 블록(```) 내부는 건드리지 않음.
 */
export function fixMisalignedBoldMarks(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // 단어 문자: 영숫자 + 언더스코어 + CJK
    const wRe = /[\w\u4e00-\u9fff\uac00-\ud7af\u3040-\u30ff\u3100-\u312f]/;

    // 전략: 각 **...** 쌍을 개별적으로 찾아서 경계 보정
    // **...** 내부에 **를 포함하지 않는 콘텐츠만 매칭
    const boldRe = /\*\*((?:[^*]|\*(?!\*))+)\*\*/g;
    let fixed = '';
    let lastIndex = 0;
    let match;

    while ((match = boldRe.exec(line)) !== null) {
      const fullMatch = match[0];         // **content**
      const content = match[1];           // content
      const matchStart = match.index;     // position of first *
      const matchEnd = matchStart + fullMatch.length;

      // 이 bold 이전의 텍스트
      let before = line.slice(lastIndex, matchStart);
      // 이 bold 이후의 텍스트 (peek)
      const after = line.slice(matchEnd);

      // 패턴 2: before 끝에 단어문자가 붙어있으면 mark 안으로
      let prefix = '';
      const prefixMatch = before.match(new RegExp(`(${wRe.source}+)$`));
      if (prefixMatch) {
        prefix = prefixMatch[1] ?? '';
        before = before.slice(0, -prefix.length);
      }

      // 패턴 1: after 시작에 단어문자가 붙어있으면 mark 안으로
      let suffix = '';
      const suffixMatch = after.match(new RegExp(`^(${wRe.source}+)`));
      if (suffixMatch) {
        suffix = suffixMatch[1] ?? '';
        // boldRe.lastIndex를 suffix 길이만큼 앞으로
        boldRe.lastIndex = matchEnd + suffix.length;
      }

      // 패턴 3: mark 안 앞뒤 공백을 mark 밖으로
      let innerContent = prefix + content + suffix;
      let leadingSpace = '';
      let trailingSpace = '';
      const spaceMatch = innerContent.match(/^(\s+)([\s\S]*?)(\s+)$/);
      if (spaceMatch) {
        leadingSpace = spaceMatch[1] ?? '';
        innerContent = spaceMatch[2] ?? '';
        trailingSpace = spaceMatch[3] ?? '';
      } else {
        const leadMatch = innerContent.match(/^(\s+)([\s\S]*)$/);
        if (leadMatch) {
          leadingSpace = leadMatch[1] ?? '';
          innerContent = leadMatch[2] ?? '';
        }
        const trailMatch = innerContent.match(/^([\s\S]*?)(\s+)$/);
        if (trailMatch) {
          innerContent = trailMatch[1] ?? '';
          trailingSpace = trailMatch[2] ?? '';
        }
      }

      // leading space가 있으면 before 끝의 공백과 합쳐서 단일 공백으로
      if (leadingSpace && before.endsWith(' ')) {
        before = before.replace(/ +$/, '');
        leadingSpace = ' ';
      }

      fixed += before + leadingSpace + '**' + innerContent + '**' + trailingSpace;
      lastIndex = boldRe.lastIndex || matchEnd;
    }

    // 나머지 텍스트 추가
    let remaining = line.slice(lastIndex);
    // trailing space가 있었으면 remaining 시작의 공백과 합쳐서 단일 공백으로
    if (fixed.endsWith(' ') && remaining.startsWith(' ')) {
      remaining = remaining.replace(/^ +/, '');
    }
    fixed += remaining;

    result.push(fixed);
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
 * 콘텐츠가 블록 레벨 HTML인지 감지 (AI가 마크다운 대신 HTML 반환한 경우)
 */
function looksLikeBlockHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<') || !trimmed.includes('</')) return false;
  return /^<(ul|ol|li|p|div|table|tr|td|th)[\s>]/i.test(trimmed);
}

/**
 * AI가 반환한 HTML(ul/ol/li/p)을 마크다운으로 변환
 * htmlToTipTapJson은 Markdown extension(html: false)으로 HTML을 파싱하지 못해
 * raw 텍스트로 처리하므로, HTML → 마크다운 변환 후 파싱
 */
function convertHtmlListsToMarkdown(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const lines: string[] = [];

    function walk(el: Element, indent = ''): void {
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        for (const child of el.children) {
          if (child.tagName === 'LI') walk(child as Element, indent);
        }
        return;
      }
      if (el.tagName === 'LI') {
        const parts: string[] = [];
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            parts.push(`${indent}- ${node.textContent.trim()}`);
          } else if (node instanceof Element) {
            if (node.tagName === 'UL' || node.tagName === 'OL') {
              walk(node, indent + '  ');
            } else if (node.tagName === 'P') {
              const t = node.textContent?.trim();
              if (t) parts.push(`${indent}- ${t}`);
            } else {
              walk(node, indent);
            }
          }
        }
        if (parts.length === 0) {
          const t = el.textContent?.trim();
          if (t) lines.push(`${indent}- ${t}`);
        } else {
          lines.push(...parts);
        }
        return;
      }
      if (el.tagName === 'P') {
        const t = el.textContent?.trim();
        if (t) lines.push(`${indent}${t}`);
        return;
      }
      if (el.tagName === 'TABLE') {
        // 테이블은 HTML 그대로 유지 (markdownToTipTapJsonForTranslation이 html: true로 파싱)
        lines.push((el as HTMLElement).outerHTML);
        return;
      }
      for (const child of el.children) {
        walk(child as Element, indent);
      }
    }

    for (const child of doc.body.children) {
      walk(child as Element);
    }
    return lines.join('\n').trim() || html;
  } catch {
    return html;
  }
}

/**
 * 혼합 콘텐츠(Markdown + HTML 테이블)를 세그먼트로 분리
 *
 * HTML 테이블 블록은 markdown-it에서 셀 내 블록 요소(ul, ol 등)를 파싱하지 못하므로
 * 별도로 분리하여 ProseMirror DOMParser로 파싱합니다.
 */
type ContentSegment =
  | { type: 'markdown'; content: string }
  | { type: 'html-table'; content: string };

const TABLE_OPEN_RE = /<table[\s>]/i;
const TABLE_OPEN_STICKY = /<table[\s>]/iy;
const TABLE_CLOSE_STICKY = /<\/table\s*>/iy;

function splitTablesFromContent(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const tableStart = remaining.search(TABLE_OPEN_RE);

    if (tableStart === -1) {
      segments.push({ type: 'markdown', content: remaining });
      break;
    }

    if (tableStart > 0) {
      segments.push({ type: 'markdown', content: remaining.slice(0, tableStart) });
    }

    let depth = 0;
    let i = tableStart;
    let tableEnd = -1;

    while (i < remaining.length) {
      TABLE_OPEN_STICKY.lastIndex = i;
      TABLE_CLOSE_STICKY.lastIndex = i;

      if (TABLE_OPEN_STICKY.test(remaining)) {
        depth++;
        i = remaining.indexOf('>', i) + 1;
      } else {
        const closeMatch = TABLE_CLOSE_STICKY.exec(remaining);
        if (closeMatch) {
          depth--;
          if (depth === 0) {
            tableEnd = TABLE_CLOSE_STICKY.lastIndex;
            break;
          }
          i = TABLE_CLOSE_STICKY.lastIndex;
        } else {
          // Skip to next '<' to avoid character-by-character scanning
          const nextAngle = remaining.indexOf('<', i + 1);
          i = nextAngle === -1 ? remaining.length : nextAngle;
        }
      }
    }

    if (tableEnd === -1) {
      segments.push({ type: 'markdown', content: remaining.slice(tableStart) });
      break;
    }

    segments.push({ type: 'html-table', content: remaining.slice(tableStart, tableEnd) });
    remaining = remaining.slice(tableEnd);
  }

  return segments;
}

/**
 * 번역 응답 후처리: HTML/마크다운 구분 후 TipTap JSON 변환
 *
 * - AI가 HTML(ul, ol, li, p 등)을 반환하면 Markdown으로 변환 후 파싱
 * - HTML <table> 블록은 ProseMirror DOMParser로 직접 파싱하여
 *   셀 안의 bulletList/orderedList 구조를 보존
 */
export function parseTranslationResponseToTipTap(content: string): TipTapDocJson {
  const trimmed = content.trim();
  const toParse = looksLikeBlockHtml(trimmed)
    ? convertHtmlListsToMarkdown(trimmed)
    : trimmed;
  const normalized = normalizeHorizontalRules(toParse);

  // 테이블이 없으면 기존 markdown-it 경로 그대로
  if (!TABLE_OPEN_RE.test(normalized)) {
    return markdownToTipTapJsonForTranslation(normalized);
  }

  // 테이블은 ProseMirror DOMParser로, 나머지는 markdown-it으로
  const segments = splitTablesFromContent(normalized);
  const editor = new Editor({
    extensions: getExtensionsForTranslation(),
  });

  try {
    const schema = editor.state.schema;
    const allNodes: unknown[] = [];

    for (const segment of segments) {
      if (segment.type === 'markdown') {
        if (!segment.content.trim()) continue;
        editor.commands.setContent(segment.content);
        const json = editor.getJSON() as TipTapDocJson;
        const nodes = json.content as unknown[];
        if (nodes) allNodes.push(...nodes);
      } else {
        const div = document.createElement('div');
        div.innerHTML = DOMPurify.sanitize(segment.content);
        const parsed = PMDOMParser.fromSchema(schema).parse(div);
        parsed.content.forEach(node => {
          allNodes.push(node.toJSON());
        });
      }
    }

    return { type: 'doc', content: allNodes };
  } finally {
    editor.destroy();
  }
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
