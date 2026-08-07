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
            // 생긴 중복 ID는 findAlignedCounterpartUnits가 고유 ID 기준으로 허용한다.
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
