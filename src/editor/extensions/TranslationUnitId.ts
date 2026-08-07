import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { v4 as uuidv4 } from 'uuid';

const TRANSLATION_UNIT_TYPES = new Set(['paragraph', 'heading', 'tableCell']);

export interface TranslationUnitDocument {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TranslationUnitDocument[];
  text?: string;
  [key: string]: unknown;
}

export interface TranslationUnit {
  id?: string;
  type: string;
  path: number[];
  text: string;
  /** heading일 때만 채워진다. 정렬에서 h2↔h3 오매칭을 막는 용도(alignUnits.ts) */
  level?: number;
}

export interface TranslationUnitReattachmentResult {
  doc: TranslationUnitDocument;
  alignedUnitIds: string[];
  unalignedPaths: string[];
}

export interface TranslationUnitIdOptions {
  assignMissingIds: boolean;
}

export interface CollectAlignedSourceUnitsOptions {
  /**
   * ID가 하나도 맞지 않는 legacy 문서에서만 문서 순번 fallback을 허용한다.
   * 정렬 검사(alignUnits)와 같은 1:1 구조 기준(개수·타입·깊이·heading 레벨)을
   * 만족할 때만 동작하므로, 정렬 뷰가 "일치"로 보여주는 문서는 여기서도 같은
   * 결론이 나온다. 새 호출부는 잘못된 원문 추측의 비용을 따져 명시적으로 켤 것.
   */
  allowLegacyOrderFallback?: boolean;
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTranslationUnit(node: TranslationUnitDocument): boolean {
  return TRANSLATION_UNIT_TYPES.has(node.type);
}

function nodeText(node: TranslationUnitDocument): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  return (node.content ?? []).map(nodeText).join('');
}

function pathKey(path: number[]): string {
  return path.join('.');
}

function visitDocument(
  node: TranslationUnitDocument,
  visitor: (node: TranslationUnitDocument, path: number[]) => void,
  path: number[] = [],
): void {
  visitor(node, path);
  node.content?.forEach((child, index) => visitDocument(child, visitor, [...path, index]));
}

function nodeAtPath(
  doc: TranslationUnitDocument,
  path: number[],
): TranslationUnitDocument | null {
  let current = doc;
  for (const index of path) {
    const next = current.content?.[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

export function collectTranslationUnits(doc: TranslationUnitDocument): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  visitDocument(doc, (node, path) => {
    if (!isTranslationUnit(node)) return;
    const id = node.attrs?.translationUnitId;
    const level = node.attrs?.level;
    units.push({
      ...(typeof id === 'string' && id.length > 0 ? { id } : {}),
      type: node.type,
      path,
      text: nodeText(node),
      ...(typeof level === 'number' ? { level } : {}),
    });
  });
  return units;
}

export function ensureTranslationUnitIds(
  doc: TranslationUnitDocument,
  idFactory: () => string = uuidv4,
): TranslationUnitDocument {
  const next = cloneDocument(doc);
  visitDocument(next, (node) => {
    if (!isTranslationUnit(node)) return;
    const existingId = node.attrs?.translationUnitId;
    if (typeof existingId === 'string' && existingId.length > 0) return;
    node.attrs = { ...(node.attrs ?? {}), translationUnitId: idFactory() };
  });
  return next;
}

export function reattachTranslationUnitIds(
  source: TranslationUnitDocument,
  target: TranslationUnitDocument,
): TranslationUnitReattachmentResult {
  const sourceUnits = collectTranslationUnits(source);
  const targetUnits = collectTranslationUnits(target);
  const topologyMatches =
    sourceUnits.length === targetUnits.length &&
    sourceUnits.every((sourceUnit, index) => {
      const targetUnit = targetUnits[index];
      return (
        targetUnit &&
        sourceUnit.type === targetUnit.type &&
        pathKey(sourceUnit.path) === pathKey(targetUnit.path)
      );
    });

  const next = cloneDocument(target);
  if (!topologyMatches) {
    return {
      doc: next,
      alignedUnitIds: [],
      unalignedPaths: targetUnits.map((unit) => pathKey(unit.path)),
    };
  }

  const alignedUnitIds: string[] = [];
  sourceUnits.forEach((sourceUnit, index) => {
    if (!sourceUnit.id) return;
    const targetUnit = targetUnits[index];
    if (!targetUnit) return;
    const targetNode = nodeAtPath(next, targetUnit.path);
    if (!targetNode) return;
    targetNode.attrs = {
      ...(targetNode.attrs ?? {}),
      translationUnitId: sourceUnit.id,
    };
    alignedUnitIds.push(sourceUnit.id);
  });

  return { doc: next, alignedUnitIds, unalignedPaths: [] };
}

/**
 * Target 선택 유닛 ID에 대응하는 Source 유닛을 찾는다.
 * 1차: translationUnitId 직접 매칭 (전체 번역/폴리싱 적용 시 reattach된 문서).
 * 2차 fallback(명시적 opt-in): reattach 이전 legacy 문서는 Source/Target ID가
 * 독립 생성되어 매칭되지 않는다. 빈 유닛(빈 문단 등)을 제외한 내용 유닛의
 * 개수·타입이 1:1로 일치할 때만 같은 순번의 Source 유닛으로 대응한다.
 * (번역 과정에서 생기는 빈 문단 개수 차이에 관대하게 동작)
 */
export function collectAlignedSourceUnits(
  sourceDoc: TranslationUnitDocument,
  targetDoc: TranslationUnitDocument,
  selectedUnitIds: string[],
  options: CollectAlignedSourceUnitsOptions = {},
): TranslationUnit[] {
  const selectedIds = new Set(selectedUnitIds);
  if (selectedIds.size === 0) return [];
  const sourceUnits = collectTranslationUnits(sourceDoc);
  const byId = sourceUnits.filter((unit) => unit.id && selectedIds.has(unit.id));
  // keepOnSplit 이력·붙여넣기로 같은 ID가 여러 유닛에 복제된 문서가 있으므로
  // 유닛 개수가 아니라 매칭된 고유 ID 수로 판정한다. 중복 유닛은 문서 순서
  // 그대로 모두 반환한다 — 분할된 반쪽들을 합치면 원래 유닛 전체가 된다.
  const matchedIds = new Set(byId.map((unit) => unit.id));
  if (matchedIds.size === selectedIds.size) return byId;
  // 일부만 맞는 혼합 상태에서 부분 원문을 반환하면 선택의 나머지가 조용히 빠진다.
  if (matchedIds.size > 0 || options.allowLegacyOrderFallback !== true) return [];

  const sourceContentUnits = sourceUnits.filter((unit) => unit.text.trim());
  const targetContentUnits = collectTranslationUnits(targetDoc)
    .filter((unit) => unit.text.trim());
  // 정렬 검사(alignUnits.signature)와 같은 기준 — 타입에 더해 중첩 깊이와
  // heading 레벨까지 맞아야 순번 대응을 신뢰한다.
  const aligned =
    sourceContentUnits.length === targetContentUnits.length &&
    targetContentUnits.every((unit, index) => {
      const sourceUnit = sourceContentUnits[index];
      return (
        sourceUnit?.type === unit.type &&
        sourceUnit.path.length === unit.path.length &&
        (sourceUnit.level ?? null) === (unit.level ?? null)
      );
    });
  if (!aligned) return [];

  return targetContentUnits.flatMap((unit, index) => {
    const sourceUnit = sourceContentUnits[index];
    return unit.id && selectedIds.has(unit.id) && sourceUnit ? [sourceUnit] : [];
  });
}

function isAncestorPath(ancestor: number[], descendant: number[]): boolean {
  return (
    ancestor.length < descendant.length &&
    ancestor.every((index, depth) => descendant[depth] === index)
  );
}

/**
 * 조상 유닛을 버리고 가장 안쪽 유닛만 남긴다.
 *
 * 표 셀은 `tableCell`과 그 안의 `paragraph`가 **둘 다** 번역 단위라, 셀 안을
 * 선택하면 `getTranslationUnitIdsAtRange`가 셀 ID와 문단 ID를 함께 돌려준다.
 * 그대로 원문을 모으면 셀 전체 텍스트(제목·불릿이 구분자 없이 붙은 한 덩이)와
 * 선택 문단 텍스트가 같이 들어가 원문이 중복된다.
 *
 * "선택한 한 문단의 원문"만 필요한 경로(선택 재번역)에서 쓴다 — 앞뒤 문맥을
 * 세는 경로(`selectionTools.dropDuplicatedContainers`)는 조상을 확실히 중복일
 * 때만 버리는 다른 규칙이다.
 */
export function dropAncestorUnits(units: TranslationUnit[]): TranslationUnit[] {
  return units.filter(
    (unit) => !units.some((other) => isAncestorPath(unit.path, other.path)),
  );
}

export function getTranslationUnitIdsAtRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string[] {
  const ids = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    const id = node.attrs?.translationUnitId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  });
  return [...ids];
}

function buildAssignMissingIdsTransaction(
  tr: Transaction,
  doc: ProseMirrorNode,
): Transaction | null {
  let changed = false;
  doc.descendants((node, pos) => {
    if (!TRANSLATION_UNIT_TYPES.has(node.type.name)) return;
    if (typeof node.attrs.translationUnitId === 'string' && node.attrs.translationUnitId) return;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      translationUnitId: uuidv4(),
    });
    changed = true;
  });
  if (!changed) return null;
  // ID 부여는 undo 대상이 아니다 (undo 시 ID가 사라지면 선택/앵커 참조가 깨짐).
  return tr.setMeta('addToHistory', false);
}

export const TranslationUnitId = Extension.create<TranslationUnitIdOptions>({
  name: 'translationUnitId',

  addOptions() {
    return {
      assignMissingIds: true,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'tableCell'],
        attributes: {
          translationUnitId: {
            default: null,
            // 문단 끝 Enter(새 블록 추가)에서 ID가 새 블록에 복제되지 않게 한다
            // (TipTap 기본은 keepOnSplit: true). 새 블록은 아래 plugin이 새 ID를
            // 발급한다. 단, 문단 중간 분할은 TipTap이 types 없이 ProseMirror
            // split을 불러 attrs가 통째로 복사되므로 여기로는 못 막는다 — 그렇게
            // 생긴 중복 ID는 collectAlignedSourceUnits가 고유 ID 기준으로 허용한다.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-translation-unit-id'),
            renderHTML: (attributes) => {
              if (!attributes.translationUnitId) return {};
              return {
                'data-translation-unit-id': attributes.translationUnitId,
              };
            },
          },
        },
      },
    ];
  },

  // 주의: `appendTransaction`은 TipTap Extension 설정 키가 아니라 ProseMirror
  // Plugin 스펙이다. Extension 최상위에 두면 조용히 무시되어 ID가 영영 부여되지
  // 않는다. 초기 로드는 onCreate, 이후 편집/setContent는 plugin이 담당한다.
  onCreate() {
    if (!this.options.assignMissingIds) return;
    const { state, view } = this.editor;
    const tr = buildAssignMissingIdsTransaction(state.tr, state.doc);
    if (tr) view.dispatch(tr);
  },

  addProseMirrorPlugins() {
    if (!this.options.assignMissingIds) return [];
    return [
      new Plugin({
        appendTransaction: (
          transactions: readonly Transaction[],
          _oldState: EditorState,
          newState: EditorState,
        ) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          return buildAssignMissingIdsTransaction(newState.tr, newState.doc);
        },
      }),
    ];
  },
});
