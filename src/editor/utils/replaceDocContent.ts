import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import DOMPurify from 'dompurify';
import { wrapBlockImagesInParagraphs, type TipTapDocJson } from '@/utils/markdownConverter';

/** 에디터 스키마에 없는 마크를 벗긴다 (예: 링크 보존을 끈 에디터에 들어오는 link). */
function stripUnknownMarks(node: TipTapDocJson, schema: Schema): TipTapDocJson {
  if (!node || typeof node !== 'object') return node;
  const next: TipTapDocJson = { ...node };
  if (Array.isArray(node.marks)) {
    next.marks = (node.marks as TipTapDocJson[]).filter(
      (mark) => typeof mark?.type === 'string' && mark.type in schema.marks,
    );
  }
  if (Array.isArray(node.content)) {
    next.content = (node.content as TipTapDocJson[]).map((child) => stripUnknownMarks(child, schema));
  }
  return next;
}

/**
 * JSON을 에디터 스키마 문서로 만든다.
 *
 * HTML과 달리 `nodeFromJSON`은 구조를 검증하지 않는다. 변환 스키마(block image,
 * 항상 Link)에서 만든 JSON이 그대로 들어오면 invalid 문서가 에디터에 자리 잡고,
 * 이후 편집에서야 "Invalid content for node …"가 터진다. 그래서 스키마 차이를
 * 정규화한 뒤, 고칠 수 없는 구조는 교체 전에 `check()`로 실패시킨다.
 */
function createDocumentFromJson(schema: Schema, json: TipTapDocJson): ProseMirrorNode {
  const normalized = schema.nodes.image?.isInline ? wrapBlockImagesInParagraphs(json) : json;
  const doc = schema.nodeFromJSON(stripUnknownMarks(normalized, schema));
  doc.check();
  return doc;
}

/** 에디터 스키마로 교체용 문서를 생성한다. 문자열은 저장 전에 정화한다. */
export function createDocumentFromContent(
  editor: Editor,
  content: string | Record<string, unknown>,
): ProseMirrorNode {
  const { schema } = editor.state;
  return typeof content === 'string'
    ? PMDOMParser.fromSchema(schema).parse(
        Object.assign(document.createElement('div'), {
          innerHTML: DOMPurify.sanitize(content),
        }),
      )
    : createDocumentFromJson(schema, content);
}

/**
 * ProseMirror 트랜잭션으로 에디터 콘텐츠를 교체합니다.
 *
 * `editor.commands.setContent()`와의 차이:
 * - `preventUpdate`를 설정하지 않아 `onUpdate` 콜백이 정상 발동 → store 자동 동기화
 * - `addToHistory` 명시 제어: sync용 false, 번역 적용용 true
 *
 * 보안: string 입력은 DOMPurify로 sanitize 후 innerHTML에 할당합니다.
 * 현재 모든 호출부의 HTML은 내부 생성(buildSourceDocument, buildTargetDocument,
 * store content)이지만, defense-in-depth로 sanitize를 적용합니다.
 */
export function replaceDocContent(
  editor: Editor,
  content: string | Record<string, unknown>,
  options: { addToHistory?: boolean } = {},
): void {
  const { addToHistory = true } = options;
  const { state } = editor;
  const newDoc = createDocumentFromContent(editor, content);

  const { tr } = state;
  tr.replaceWith(0, state.doc.content.size, newDoc.content);
  tr.setMeta('selectionAnchorDocumentReplace', true);
  if (!addToHistory) tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}
