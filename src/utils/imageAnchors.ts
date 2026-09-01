import { v4 as uuidv4 } from 'uuid';
import type { TipTapDocJson } from './markdownConverter';

/**
 * 번역 요청 동안에만 사용하는 이미지 앵커 접두사.
 *
 * 실제 이미지 URL/Base64는 번역 입력에 포함하지 않고, Markdown 왕복이
 * 가능한 짧은 문자열만 남긴다. 복원 시 이 접두사를 가진 image 노드만
 * 원본 노드로 치환한다.
 */
const IMAGE_ANCHOR_PREFIX = 'oddeyes-image-anchor:';
const COMPLETE_IMAGE_ANCHOR_MARKDOWN = /!\[[^\]]*\]\(oddeyes-image-anchor:[^)]+\)/g;
const INCOMPLETE_IMAGE_ANCHOR_MARKDOWN = /!\[[^\]\n]*(?:ODDEYES_IMAGE_|oddeyes-image-anchor:)[^\)\n]*$/gm;

export interface ImageAnchor {
  id: string;
  node: TipTapDocJson;
  path: number[];
}

export interface ImageAnchorPreparation {
  doc: TipTapDocJson;
  anchors: ImageAnchor[];
}

/**
 * 번역 스트리밍 미리보기에서 내부 이미지 앵커를 숨긴다.
 *
 * 최종 JSON 복원에는 앵커가 필요하지만, 사용자가 보는 진행 텍스트에는
 * 노출할 필요가 없다. 스트림 chunk 경계에서 Markdown이 잘릴 수 있으므로
 * 완성된 앵커와 줄 끝의 미완성 앵커를 모두 제거한다.
 */
export function hideImageAnchorsFromStreaming(markdown: string): string {
  return markdown
    .replace(COMPLETE_IMAGE_ANCHOR_MARKDOWN, '')
    .replace(INCOMPLETE_IMAGE_ANCHOR_MARKDOWN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readAttrs(node: TipTapDocJson): Record<string, unknown> {
  return node.attrs && typeof node.attrs === 'object'
    ? node.attrs as Record<string, unknown>
    : {};
}

function readAnchorId(node: TipTapDocJson): string | null {
  if (node.type !== 'image') return null;
  const src = readAttrs(node).src;
  if (typeof src !== 'string' || !src.startsWith(IMAGE_ANCHOR_PREFIX)) return null;
  const id = src.slice(IMAGE_ANCHOR_PREFIX.length);
  return id.length > 0 ? id : null;
}

function visitMutable(
  node: TipTapDocJson,
  visitor: (node: TipTapDocJson, path: number[]) => void,
  path: number[] = [],
): void {
  visitor(node, path);
  if (!Array.isArray(node.content)) return;

  node.content.forEach((child, index) => {
    if (child && typeof child === 'object') {
      visitMutable(child as TipTapDocJson, visitor, [...path, index]);
    }
  });
}

/**
 * 원본 문서의 image 노드를 짧은 앵커 image로 바꾼다.
 *
 * 문서 트리의 위치와 부모 구조는 그대로 유지하므로, 번역 결과가 텍스트
 * 길이만 바뀌어도 앵커가 남아 있는 한 이미지 위치를 잃지 않는다.
 */
export function prepareImageAnchors(
  sourceDoc: TipTapDocJson,
  idFactory: () => string = uuidv4,
): ImageAnchorPreparation {
  const doc = clone(sourceDoc);
  const anchors: ImageAnchor[] = [];

  visitMutable(doc, (node, path) => {
    if (node.type !== 'image') return;

    const id = idFactory();
    if (!id || id.includes(':')) {
      throw new Error('이미지 앵커 ID는 비어 있거나 콜론을 포함할 수 없습니다.');
    }

    anchors.push({
      id,
      node: clone(node),
      path,
    });

    node.attrs = {
      ...readAttrs(node),
      src: `${IMAGE_ANCHOR_PREFIX}${id}`,
      alt: `ODDEYES_IMAGE_${id}`,
      title: null,
    };
  });

  return { doc, anchors };
}

/**
 * 번역 결과에 남아 있는 이미지 앵커를 원본 image 노드로 되돌린다.
 *
 * 앵커가 하나라도 누락·중복·재배치되면 조용히 적용하지 않는다. 이 검증이
 * 있어야 모델이 문서 구조를 일부 바꾼 경우 잘못된 위치에 이미지를 넣지 않는다.
 */
export function restoreImageAnchors(
  translatedDoc: TipTapDocJson,
  anchors: readonly ImageAnchor[],
): TipTapDocJson {
  const expectedIds = anchors.map((anchor) => anchor.id);
  if (new Set(expectedIds).size !== expectedIds.length) {
    throw new Error('이미지 앵커 ID가 중복되었습니다.');
  }

  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const actualIds: string[] = [];
  const doc = clone(translatedDoc);

  visitMutable(doc, (node) => {
    const id = readAnchorId(node);
    if (!id) return;
    actualIds.push(id);

    const anchor = byId.get(id);
    if (!anchor) {
      throw new Error(`알 수 없는 이미지 앵커입니다: ${id}`);
    }

    // 현재 위치의 node 객체만 원본 node로 교체할 수 있도록 부모를 직접
    // 전달하지 않고 attrs를 복사한다. 자식 순서·부모 경로는 그대로 유지된다.
    node.type = anchor.node.type;
    node.attrs = clone(anchor.node.attrs ?? {});
    if (anchor.node.content !== undefined) node.content = clone(anchor.node.content);
    else delete node.content;
    if (anchor.node.marks !== undefined) node.marks = clone(anchor.node.marks);
    else delete node.marks;
  });

  const sameOrder =
    actualIds.length === expectedIds.length &&
    actualIds.every((id, index) => id === expectedIds[index]);
  if (!sameOrder) {
    throw new Error(
      `이미지 앵커가 누락되었거나 순서가 변경되었습니다. ` +
      `(expected=${expectedIds.join(',')}, actual=${actualIds.join(',')})`,
    );
  }

  return doc;
}
