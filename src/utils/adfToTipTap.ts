/**
 * ADF(Atlassian Document Format) → TipTap JSON 변환기
 *
 * Confluence에서 받은 ADF 문서를 TipTap 에디터가 렌더링할 수 있는
 * TipTap JSON 형식으로 변환합니다.
 *
 * 변환 원칙:
 * - 1:1 매핑 가능한 노드는 그대로 변환 (paragraph, heading, table 등)
 * - Confluence 전용 노드(panel, expand, layoutSection)는 근사 변환 (텍스트 보존 우선)
 * - 알 수 없는 노드는 자식 콘텐츠를 평탄화하여 포함
 * - 마크: ADF mark type → TipTap mark type 매핑
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

import type { AdfDocument, AdfNode } from './adfParser';
import type { TipTapDocJson } from './markdownConverter';

// ============================================================================
// Mark 타입 매핑 (ADF → TipTap)
// subsup / textColor는 별도 분기에서 처리하므로 맵에서 제외
// ============================================================================

const MARK_TYPE_MAP: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  underline: 'underline',
  strike: 'strike',
  code: 'code',
  link: 'link',
  // subsup: 별도 분기 처리 (sub/sup attrs로 구분)
  // textColor: TextStyle extension 미설치이므로 무시
};

// ============================================================================
// 내부 헬퍼
// ============================================================================

/**
 * ADF mark 배열 → TipTap mark 배열 변환
 */
function convertMarks(
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>
): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const result: Array<{ type: string; attrs?: Record<string, unknown> }> = [];

  for (const mark of marks) {
    // subsup: ADF attrs.type = 'sub' | 'sup' → subscript / superscript
    if (mark.type === 'subsup') {
      const tiptapType = mark.attrs?.type === 'sup' ? 'superscript' : 'subscript';
      result.push({ type: tiptapType });
      continue;
    }

    const tiptapType = MARK_TYPE_MAP[mark.type];
    if (!tiptapType) continue; // 알 수 없는 mark 무시 (textColor 포함)

    if (mark.type === 'link') {
      result.push({
        type: 'link',
        attrs: { href: mark.attrs?.href ?? '', target: mark.attrs?.target ?? null },
      });
    } else if (mark.attrs) {
      result.push({ type: tiptapType, attrs: mark.attrs });
    } else {
      result.push({ type: tiptapType });
    }
  }

  return result;
}

/**
 * ADF 노드 배열 → TipTap 노드 배열 변환 (재귀)
 */
function convertNodes(nodes: AdfNode[]): TipTapDocJson[] {
  const result: TipTapDocJson[] = [];

  for (const node of nodes) {
    const converted = convertNode(node);
    if (converted !== null) {
      if (Array.isArray(converted)) {
        result.push(...converted);
      } else {
        result.push(converted);
      }
    }
  }

  return result;
}

/**
 * ADF 단일 노드 → TipTap 노드 변환
 * null 반환 시 해당 노드 스킵
 * 배열 반환 시 평탄화 (Confluence 전용 컨테이너 노드용)
 */
function convertNode(node: AdfNode): TipTapDocJson | TipTapDocJson[] | null {
  switch (node.type) {
    // ── 직접 매핑 노드 ──────────────────────────────────────────────────────

    case 'paragraph':
      return {
        type: 'paragraph',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'heading': {
      // TipTap StarterKit은 level 1-6만 허용 — 범위 밖 값 클램핑
      const rawLevel = (node.attrs?.level as number) ?? 1;
      const level = Math.min(6, Math.max(1, rawLevel));
      return {
        type: 'heading',
        attrs: { level },
        content: node.content ? convertNodes(node.content) : [],
      };
    }

    case 'text': {
      const tiptapNode: TipTapDocJson = { type: 'text', text: node.text ?? '' };
      if (node.marks && node.marks.length > 0) {
        const converted = convertMarks(node.marks);
        if (converted.length > 0) tiptapNode.marks = converted;
      }
      return tiptapNode;
    }

    case 'hardBreak':
      return { type: 'hardBreak' };

    case 'rule':
      return { type: 'horizontalRule' };

    case 'blockquote':
      return {
        type: 'blockquote',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'codeBlock':
      return {
        type: 'codeBlock',
        attrs: { language: (node.attrs?.language as string) ?? null },
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'bulletList':
      return {
        type: 'bulletList',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'orderedList':
      return {
        type: 'orderedList',
        // ADF: attrs.order / TipTap: attrs.start
        attrs: { start: (node.attrs?.order as number) ?? 1 },
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'listItem':
      return {
        type: 'listItem',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'table':
      return {
        type: 'table',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'tableRow':
      return {
        type: 'tableRow',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'tableHeader':
      return {
        type: 'tableHeader',
        attrs: buildTableCellAttrs(node),
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'tableCell':
      return {
        type: 'tableCell',
        attrs: buildTableCellAttrs(node),
        content: node.content ? convertNodes(node.content) : [],
      };

    // ── Confluence 전용 노드 (근사 변환) ────────────────────────────────────

    case 'panel':
      // info/warning/note/success/error 패널 → blockquote
      return {
        type: 'blockquote',
        content: node.content ? convertNodes(node.content) : [],
      };

    case 'expand':
    case 'nestedExpand':
      // 접힌 섹션 → title(bold paragraph) + 내용 펼침
      return buildExpandNodes(node);

    case 'layoutSection':
      // 다단 레이아웃 → 단일 컬럼으로 순서대로 펼침
      return node.content ? convertNodes(node.content) : [];

    case 'layoutColumn':
      // layoutColumn → 내용 평탄화
      return node.content ? convertNodes(node.content) : [];

    case 'bodiedExtension':
    case 'inlineExtension':
    case 'extension':
      // Confluence 매크로 → 내용 평탄화 (또는 스킵)
      return node.content ? convertNodes(node.content) : null;

    case 'mediaSingle':
      // 미디어 컨테이너 → 내부 media 노드 처리
      return node.content ? convertNodes(node.content) : null;

    case 'media': {
      // URL이 있을 때만 image 노드 생성. UUID(id만 있는 경우)는 broken image가 되므로 스킵
      const src = node.attrs?.url as string | undefined;
      if (!src) return null;
      return { type: 'image', attrs: { src, alt: null, title: null } };
    }

    case 'inlineCard': {
      // 인라인 Smart link → text + link mark
      const url = (node.attrs?.url as string) ?? '';
      if (!url) return null;
      return {
        type: 'text',
        text: url,
        marks: [{ type: 'link', attrs: { href: url, target: null } }],
      };
    }

    case 'blockCard':
    case 'embedCard': {
      // 블록 레벨 Smart link → paragraph로 감싸서 반환
      const url = (node.attrs?.url as string) ?? '';
      if (!url) return null;
      return {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: url,
            marks: [{ type: 'link', attrs: { href: url, target: null } }],
          },
        ],
      };
    }

    case 'mention': {
      // @멘션 → 텍스트
      const name = (node.attrs?.text as string) ?? (node.attrs?.id as string) ?? '@mention';
      return { type: 'text', text: name };
    }

    case 'emoji': {
      // 이모지 → 텍스트 (text 우선, 없으면 shortName)
      const emoji = (node.attrs?.text as string) ?? (node.attrs?.shortName as string) ?? '';
      if (!emoji) return null;
      return { type: 'text', text: emoji };
    }

    case 'date': {
      // Unix epoch ms → ISO 날짜 문자열 (YYYY-MM-DD)
      const raw = node.attrs?.timestamp as string | undefined;
      if (!raw) return null;
      const ms = Number(raw);
      const dateStr = Number.isFinite(ms)
        ? new Date(ms).toISOString().slice(0, 10)
        : raw;
      return { type: 'text', text: dateStr };
    }

    case 'status': {
      // 상태 배지 → 텍스트
      const label = (node.attrs?.text as string) ?? '';
      return { type: 'text', text: `[${label}]` };
    }

    default:
      // 알 수 없는 노드: 자식이 있으면 평탄화, 없으면 스킵
      if (node.content && node.content.length > 0) {
        return convertNodes(node.content);
      }
      return null;
  }
}

/**
 * expand 노드 → bold paragraph(title) + 내용 노드 배열
 */
function buildExpandNodes(node: AdfNode): TipTapDocJson[] {
  const result: TipTapDocJson[] = [];

  const title = node.attrs?.title as string | undefined;
  if (title) {
    result.push({
      type: 'paragraph',
      content: [{ type: 'text', text: title, marks: [{ type: 'bold' }] }],
    });
  }

  if (node.content) {
    result.push(...convertNodes(node.content));
  }

  return result;
}

/**
 * ADF tableCell/tableHeader attrs → TipTap attrs
 */
function buildTableCellAttrs(node: AdfNode): Record<string, unknown> {
  return {
    colspan: (node.attrs?.colspan as number) ?? 1,
    rowspan: (node.attrs?.rowspan as number) ?? 1,
    colwidth: (node.attrs?.colwidth as number[] | null) ?? null,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * ADF 문서를 TipTap JSON으로 변환
 *
 * @param adf - Confluence ADF 문서
 * @returns TipTap JSON (type: 'doc')
 */
export function adfToTipTap(adf: AdfDocument): { type: 'doc'; content: TipTapDocJson[] } {
  return {
    type: 'doc',
    content: adf.content ? convertNodes(adf.content) : [],
  };
}
