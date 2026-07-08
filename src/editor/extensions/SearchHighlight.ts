import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  normalizeForSearch,
  buildNormalizedTextWithMapping,
} from '@/utils/normalizeForSearch';
import { pluginKeys } from '@/editor/plugins/pluginKeys';
import { useUIStore } from '@/stores/uiStore';

// ============================================
// Types
// ============================================

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  searchTerm: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  currentIndex: number;
}

export interface SearchHighlightOptions {
  searchClass: string;
  currentClass: string;
}

export interface SearchHighlightStorage {
  searchTerm: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  currentIndex: number;
  /**
   * 문서 편집 후 matches가 아직 재계산되지 않은 상태.
   * 키 입력마다 전체 재계산(O(n))을 하지 않도록 디바운스로 지연하되,
   * 매치 위치를 사용하는 커맨드(replace/navigate)는 실행 전 즉시 재계산한다.
   */
  matchesStale: boolean;
}

// ============================================
// Plugin Key
// ============================================

export const searchHighlightPluginKey = pluginKeys.searchHighlight;

// ============================================
// Helper Functions
// ============================================

export interface DocSearchIndex {
  text: string;
  positions: number[];
  /** segmentGroupId → 해당 세그먼트 블록들의 문서 범위 (min from, max to) */
  segmentRanges: Map<string, { from: number; to: number }>;
}

/**
 * 문서 텍스트/위치 매핑과 segmentGroupId→범위 맵을 한 번의 순회로 구축.
 * 이슈(k개)마다 findSegmentRange로 문서 전체(O(n))를 재스캔하지 않도록
 * ReviewHighlight/reviewApply의 excerpt 검색 컨텍스트에서 사용한다 (O(k·n) → O(n+k)).
 *
 * segmentRanges의 각 항목은 findSegmentRange(doc, id)와 동일한 결과
 * (해당 id를 가진 노드들의 최소 시작~최대 끝)를 갖는다.
 */
export function buildDocSearchIndex(doc: ProseMirrorNode): DocSearchIndex {
  let text = '';
  const positions: number[] = [];
  const segmentRanges = new Map<string, { from: number; to: number }>();

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    const segmentGroupId: unknown = node.attrs?.segmentGroupId;
    if (typeof segmentGroupId === 'string' && segmentGroupId.length > 0) {
      const nodeEnd = pos + node.nodeSize;
      const existing = segmentRanges.get(segmentGroupId);
      if (!existing) {
        segmentRanges.set(segmentGroupId, { from: pos, to: nodeEnd });
      } else {
        if (pos < existing.from) existing.from = pos;
        if (nodeEnd > existing.to) existing.to = nodeEnd;
      }
    }

    // 블록(textblock) 경계에 개행 삽입:
    // - 블록을 그대로 이어붙이면 여러 블록에 걸친 excerpt(줄바꿈 포함)가 매칭되지 않고,
    //   반대로 경계를 넘는 거짓 인접 매치("problems.Can")가 생긴다.
    // - 개행은 정규화 단계에서 공백으로 축소되며, 검색어는 trim되므로 매치 끝점이 되지 않는다.
    if (node.isTextblock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
      positions.push(pos);
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        positions.push(pos + i);
      }
      text += node.text;
    }
  });

  return { text, positions, segmentRanges };
}

/**
 * 문서의 전체 텍스트와 위치 매핑 구축
 * 노드 경계를 넘는 텍스트 검색을 위해 필요
 * (SearchHighlight / ReviewHighlight 공용)
 */
export function buildTextWithPositions(doc: ProseMirrorNode): { text: string; positions: number[] } {
  const { text, positions } = buildDocSearchIndex(doc);
  return { text, positions };
}

/**
 * 특정 segmentGroupId를 가진 블록들의 문서 위치 범위 찾기
 * Apply 시 세그먼트 범위 내에서만 매치를 찾기 위해 사용
 *
 * @param doc - ProseMirror 문서
 * @param segmentGroupId - 찾을 세그먼트 그룹 ID
 * @returns 해당 세그먼트의 시작~끝 위치, 없으면 null
 */
export function findSegmentRange(
  doc: ProseMirrorNode,
  segmentGroupId: string,
): { from: number; to: number } | null {
  let minFrom: number | null = null;
  let maxTo: number | null = null;

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    // segmentGroupId 속성을 가진 블록 노드 찾기
    if (node.attrs?.segmentGroupId === segmentGroupId) {
      const nodeEnd = pos + node.nodeSize;
      if (minFrom === null || pos < minFrom) {
        minFrom = pos;
      }
      if (maxTo === null || nodeEnd > maxTo) {
        maxTo = nodeEnd;
      }
    }
  });

  if (minFrom !== null && maxTo !== null) {
    return { from: minFrom, to: maxTo };
  }
  return null;
}

/**
 * 주어진 범위 내에 있는 매치만 필터링
 *
 * @param matches - 전체 매치 목록
 * @param range - 허용 범위 { from, to }
 * @returns 범위 내의 매치만 반환
 */
export function filterMatchesInRange(
  matches: SearchMatch[],
  range: { from: number; to: number },
): SearchMatch[] {
  return matches.filter(
    (match) => match.from >= range.from && match.to <= range.to,
  );
}

/**
 * 범위가 textblock 경계를 넘는지 판정 (교체 시 문단 병합 방지용).
 *
 * 하이라이트/매칭은 블록 경계를 넘어도 유용하지만, `tr.replaceWith`로 경계를
 * 걸친 범위를 단일 텍스트 노드로 교체하면 ProseMirror가 두 문단을 병합한다.
 * 교체 직전 이 가드로 걸러 문단/리스트 구조 파괴를 막는다.
 *
 * @param to - exclusive 끝 위치 (마지막 문자 위치 to-1로 resolve)
 */
export function rangeCrossesBlockBoundary(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): boolean {
  const $from = doc.resolve(from);
  const $to = doc.resolve(Math.max(from, to - 1));
  return !$from.sameParent($to);
}

/**
 * 검색어에 대한 모든 매치 찾기
 * 양방향 정규화: 에디터 텍스트와 검색어 모두 정규화하여 비교
 */
function findMatches(
  doc: ProseMirrorNode,
  searchTerm: string,
  caseSensitive: boolean
): SearchMatch[] {
  if (!searchTerm || searchTerm.length === 0) {
    return [];
  }

  const { text, positions } = buildTextWithPositions(doc);

  if (positions.length === 0) {
    return [];
  }

  // 에디터 텍스트 정규화
  const { normalizedText, indexMap } = buildNormalizedTextWithMapping(text);

  // 검색어 정규화
  const normalizedSearchTerm = normalizeForSearch(searchTerm);

  if (normalizedSearchTerm.length === 0) {
    return [];
  }

  const searchIn = caseSensitive ? normalizedText : normalizedText.toLowerCase();
  const searchFor = caseSensitive ? normalizedSearchTerm : normalizedSearchTerm.toLowerCase();

  const matches: SearchMatch[] = [];
  let index = 0;

  while ((index = searchIn.indexOf(searchFor, index)) !== -1) {
    // 정규화된 인덱스 → 원본 텍스트 인덱스 → 문서 위치
    const originalStartIndex = indexMap[index];
    const normalizedEndIndex = index + searchFor.length - 1;
    const originalEndIndex = normalizedEndIndex < indexMap.length
      ? indexMap[normalizedEndIndex]
      : undefined;

    if (originalStartIndex !== undefined && originalEndIndex !== undefined) {
      const fromPos = positions[originalStartIndex];
      const toPos = positions[originalEndIndex];

      if (fromPos !== undefined && toPos !== undefined) {
        matches.push({ from: fromPos, to: toPos + 1 });
      }
    }

    index += 1;
  }

  return matches;
}

/** 편집 중 매치 전체 재계산을 지연하는 idle 디바운스 시간 (ms) */
const SEARCH_MATCH_REFRESH_DEBOUNCE_MS = 300;

/**
 * storage.matches를 현재 문서 기준으로 재계산하고 currentIndex를 범위 내로 조정.
 * (구 docChanged 동기 재계산 경로와 동일한 시맨틱)
 */
function recomputeMatches(storage: SearchHighlightStorage, doc: ProseMirrorNode): void {
  storage.matches = findMatches(doc, storage.searchTerm, storage.caseSensitive);
  if (storage.currentIndex >= storage.matches.length) {
    storage.currentIndex = Math.max(0, storage.matches.length - 1);
  }
  if (storage.matches.length === 0) {
    storage.currentIndex = -1;
  }
  storage.matchesStale = false;
}

/**
 * 매치 위치를 실제로 사용하기 전에 stale이면 즉시 재계산.
 * replace 계열의 안전성(블록 경계 가드, 정확한 교체 범위)은 이 즉시 재계산으로 유지된다.
 */
function ensureMatchesFresh(storage: SearchHighlightStorage, doc: ProseMirrorNode): void {
  if (!storage.matchesStale) return;
  recomputeMatches(storage, doc);
}

/**
 * 가장 가까운 scrollable ancestor를 찾는다.
 * view.dom이 항상 scroll container가 아닐 수 있으므로
 * computed style을 확인하여 실제 스크롤 가능한 부모를 반환한다.
 */
function getScrollableAncestor(el: Element): Element | null {
  let current = el.parentElement;
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (/(auto|scroll)/.test(overflow + overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * 매치 위치로 스크롤 (포커스 이동 없이)
 * ProseMirror의 scrollIntoView는 DOM selection 기반이라
 * 검색바에 포커스가 있을 때 동작하지 않으므로 직접 스크롤
 */
function scrollToMatch(editor: { view: { dom: HTMLElement; coordsAtPos: (pos: number, side?: number) => { top: number; bottom: number } }; commands: { setTextSelection: (pos: number) => boolean } }, pos: number): void {
  editor.commands.setTextSelection(pos);
  const coords = editor.view.coordsAtPos(pos);
  const scrollContainer = getScrollableAncestor(editor.view.dom) ?? editor.view.dom;
  const rect = scrollContainer.getBoundingClientRect();
  if (coords.top < rect.top || coords.bottom > rect.bottom) {
    const zoom = useUIStore.getState().editorZoom;
    scrollContainer.scrollTop += (coords.top - rect.top - rect.height / 2) / zoom;
  }
}

/**
 * 검색 결과를 Decoration으로 변환
 */
function createSearchDecorations(
  doc: ProseMirrorNode,
  matches: SearchMatch[],
  currentIndex: number,
  searchClass: string,
  currentClass: string
): DecorationSet {
  if (matches.length === 0) {
    return DecorationSet.empty;
  }

  const decorations = matches.map((match, i) => {
    const className = i === currentIndex ? currentClass : searchClass;
    return Decoration.inline(match.from, match.to, { class: className });
  });

  return DecorationSet.create(doc, decorations);
}

// ============================================
// TipTap Extension
// ============================================

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      /**
       * 검색어 설정
       */
      setSearchTerm: (term: string) => ReturnType;
      /**
       * 대소문자 구분 설정
       */
      setCaseSensitive: (value: boolean) => ReturnType;
      /**
       * 다음 매치로 이동
       */
      nextMatch: () => ReturnType;
      /**
       * 이전 매치로 이동
       */
      prevMatch: () => ReturnType;
      /**
       * 현재 매치 치환
       */
      replaceMatch: (replacement: string) => ReturnType;
      /**
       * 모든 매치 치환
       */
      replaceAll: (replacement: string) => ReturnType;
      /**
       * 검색 초기화
       */
      clearSearch: () => ReturnType;
      /**
       * 현재 매치 인덱스 설정
       */
      setCurrentMatchIndex: (index: number) => ReturnType;
    };
  }
}

export const SearchHighlight = Extension.create<SearchHighlightOptions, SearchHighlightStorage>({
  name: 'searchHighlight',

  addOptions() {
    return {
      searchClass: 'search-match',
      currentClass: 'search-current',
    };
  },

  addStorage() {
    return {
      searchTerm: '',
      caseSensitive: false,
      matches: [] as SearchMatch[],
      currentIndex: 0,
      matchesStale: false,
    };
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          storage.searchTerm = term;

          // 매치 재계산
          storage.matches = findMatches(editor.state.doc, term, storage.caseSensitive);
          storage.currentIndex = storage.matches.length > 0 ? 0 : -1;
          storage.matchesStale = false;

          // 디버깅: 검색 결과 로그 (개발 환경에서만)
          if (process.env.NODE_ENV === 'development') {
            console.debug('[SearchHighlight:setSearchTerm]', {
              term,
              normalizedTerm: normalizeForSearch(term),
              matchCount: storage.matches.length,
              caseSensitive: storage.caseSensitive,
            });
          }

          if (dispatch) {
            // 트랜잭션에 메타 정보 추가하여 decoration 갱신
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          // 첫 번째 매치로 스크롤
          if (storage.matches.length > 0 && storage.currentIndex >= 0) {
            const match = storage.matches[storage.currentIndex];
            if (match) {
              queueMicrotask(() => {
                scrollToMatch(editor, match.from);
              });
            }
          }

          return true;
        },

      setCaseSensitive:
        (value: boolean) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          storage.caseSensitive = value;

          // 매치 재계산
          storage.matches = findMatches(editor.state.doc, storage.searchTerm, value);
          storage.currentIndex = storage.matches.length > 0 ? 0 : -1;
          storage.matchesStale = false;

          if (dispatch) {
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          return true;
        },

      nextMatch:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          ensureMatchesFresh(storage, editor.state.doc);

          if (storage.matches.length === 0) {
            return false;
          }

          storage.currentIndex = (storage.currentIndex + 1) % storage.matches.length;

          if (dispatch) {
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          // 현재 매치로 스크롤
          const match = storage.matches[storage.currentIndex];
          if (match) {
            queueMicrotask(() => {
              scrollToMatch(editor, match.from);
            });
          }

          return true;
        },

      prevMatch:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          ensureMatchesFresh(storage, editor.state.doc);

          if (storage.matches.length === 0) {
            return false;
          }

          storage.currentIndex = storage.currentIndex <= 0
            ? storage.matches.length - 1
            : storage.currentIndex - 1;

          if (dispatch) {
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          // 현재 매치로 스크롤
          const match = storage.matches[storage.currentIndex];
          if (match) {
            queueMicrotask(() => {
              scrollToMatch(editor, match.from);
            });
          }

          return true;
        },

      replaceMatch:
        (replacement: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          // 안전 가드: 편집으로 stale해진 위치로 교체하지 않도록 실행 직전 재계산
          ensureMatchesFresh(storage, editor.state.doc);

          if (storage.matches.length === 0 || storage.currentIndex < 0) {
            return false;
          }

          const match = storage.matches[storage.currentIndex];
          if (!match) {
            return false;
          }

          // 블록 경계를 넘는 매치는 교체 시 문단이 병합되므로 건너뜀
          if (rangeCrossesBlockBoundary(editor.state.doc, match.from, match.to)) {
            return false;
          }

          if (dispatch) {
            // 현재 매치 텍스트 치환 (plain text로 교체, mark 제거)
            tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
            // refresh meta로 plugin apply가 동기적으로
            // storage.matches 재계산 + currentIndex 조정 + decoration 갱신 완료
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          return true;
        },

      replaceAll:
        (replacement: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          // 안전 가드: 편집으로 stale해진 위치로 교체하지 않도록 실행 직전 재계산
          ensureMatchesFresh(storage, editor.state.doc);

          if (storage.matches.length === 0) {
            return false;
          }

          // 블록 경계를 넘는 매치는 교체 시 문단이 병합되므로 제외 (나머지는 계속 교체)
          const replaceable = storage.matches.filter(
            (match) => !rangeCrossesBlockBoundary(editor.state.doc, match.from, match.to),
          );
          if (replaceable.length === 0) {
            return false;
          }

          if (dispatch) {
            // 뒤에서부터 치환 (위치 변경 방지)
            const sortedMatches = [...replaceable].sort((a, b) => b.from - a.from);

            for (const match of sortedMatches) {
              tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
            }

            // refresh meta로 plugin apply가 동기적으로 matches 재계산 완료
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
            // replaceAll 후에는 인덱스를 0으로 리셋
            storage.currentIndex = storage.matches.length > 0 ? 0 : -1;
          }

          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          const storage = this.storage;
          storage.searchTerm = '';
          storage.matches = [];
          storage.currentIndex = -1;
          storage.matchesStale = false;

          if (dispatch) {
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          return true;
        },

      setCurrentMatchIndex:
        (index: number) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;
          ensureMatchesFresh(storage, editor.state.doc);

          if (index < 0 || index >= storage.matches.length) {
            return false;
          }

          storage.currentIndex = index;

          if (dispatch) {
            tr.setMeta(searchHighlightPluginKey, { refresh: true });
            dispatch(tr);
          }

          // 해당 매치로 스크롤
          const match = storage.matches[index];
          if (match) {
            queueMicrotask(() => {
              scrollToMatch(editor, match.from);
            });
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { searchClass, currentClass } = this.options;
    const storage = this.storage;

    return [
      new Plugin({
        key: searchHighlightPluginKey,

        state: {
          init: () => {
            return DecorationSet.empty;
          },

          apply: (tr, oldDecorationSet, _oldState, newState) => {
            // 메타 정보로 갱신 요청 확인
            const meta = tr.getMeta(searchHighlightPluginKey);

            if (meta?.refresh) {
              // 이 트랜잭션에서 문서가 바뀌었거나(교체 커맨드) 이전 편집으로 stale이면 재계산
              if (storage.searchTerm && (tr.docChanged || storage.matchesStale)) {
                recomputeMatches(storage, newState.doc);
              }
              storage.matchesStale = false;

              return createSearchDecorations(
                newState.doc,
                storage.matches,
                storage.currentIndex,
                searchClass,
                currentClass
              );
            }

            if (tr.docChanged) {
              // P2 최적화: 키 입력마다 매치 전체 재계산(O(n))을 하지 않고
              // stale 마킹 후 기존 decoration 위치만 매핑. 전체 재계산은
              // 디바운스된 refresh(view.update) 또는 매치를 사용하는 커맨드 직전에 수행.
              if (storage.searchTerm) {
                storage.matchesStale = true;
              }
              return oldDecorationSet.map(tr.mapping, tr.doc);
            }

            // 변경 없으면 기존 decoration 유지 (position mapping)
            return oldDecorationSet.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return searchHighlightPluginKey.getState(state);
          },
        },

        view: () => {
          let refreshTimer: ReturnType<typeof setTimeout> | null = null;

          return {
            update: (view, prevState) => {
              if (view.state.doc === prevState.doc) return;
              if (!storage.searchTerm || !storage.matchesStale) return;

              if (refreshTimer !== null) clearTimeout(refreshTimer);
              refreshTimer = setTimeout(() => {
                refreshTimer = null;
                if (view.isDestroyed || !storage.matchesStale) return;
                view.dispatch(
                  view.state.tr.setMeta(searchHighlightPluginKey, { refresh: true }),
                );
              }, SEARCH_MATCH_REFRESH_DEBOUNCE_MS);
            },
            destroy: () => {
              if (refreshTimer !== null) {
                clearTimeout(refreshTimer);
                refreshTimer = null;
              }
            },
          };
        },
      }),
    ];
  },
});

/**
 * 검색 상태 가져오기 헬퍼
 */
export function getSearchState(editor: { storage: { searchHighlight?: SearchHighlightStorage } }): SearchState | null {
  const storage = editor.storage.searchHighlight;
  if (!storage) return null;

  return {
    searchTerm: storage.searchTerm,
    caseSensitive: storage.caseSensitive,
    matches: storage.matches,
    currentIndex: storage.currentIndex,
  };
}
