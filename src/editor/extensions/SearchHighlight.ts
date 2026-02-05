import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  normalizeForSearch,
  buildNormalizedTextWithMapping,
} from '@/utils/normalizeForSearch';

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
}

// ============================================
// Plugin Key
// ============================================

export const searchHighlightPluginKey = new PluginKey<DecorationSet>('searchHighlight');

// ============================================
// Helper Functions
// ============================================

/**
 * 문서의 전체 텍스트와 위치 매핑 구축
 * 노드 경계를 넘는 텍스트 검색을 위해 필요
 * (ReviewHighlight.ts에서 가져온 패턴)
 */
function buildTextWithPositions(doc: ProseMirrorNode): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        positions.push(pos + i);
      }
      text += node.text;
    }
  });

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

          // 디버깅: 검색 결과 로그
          console.log('[SearchHighlight:setSearchTerm]', {
            term,
            normalizedTerm: normalizeForSearch(term),
            matchCount: storage.matches.length,
            caseSensitive: storage.caseSensitive,
          });

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
                editor.commands.setTextSelection(match.from);
                editor.commands.scrollIntoView();
                // 에디터 포커스 유지하지 않음 (검색바에 포커스 유지)
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
              editor.commands.setTextSelection(match.from);
              editor.commands.scrollIntoView();
            });
          }

          return true;
        },

      prevMatch:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;

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
              editor.commands.setTextSelection(match.from);
              editor.commands.scrollIntoView();
            });
          }

          return true;
        },

      replaceMatch:
        (replacement: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;

          if (storage.matches.length === 0 || storage.currentIndex < 0) {
            return false;
          }

          const match = storage.matches[storage.currentIndex];
          if (!match) {
            return false;
          }

          if (dispatch) {
            // 현재 매치 텍스트 치환 (plain text로 교체, mark 제거)
            tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
            dispatch(tr);
          }

          // 매치 재계산 (queueMicrotask로 트랜잭션 완료 후 실행)
          queueMicrotask(() => {
            storage.matches = findMatches(editor.state.doc, storage.searchTerm, storage.caseSensitive);
            // 인덱스 조정 (현재 위치 유지, 범위 초과 시 조정)
            if (storage.currentIndex >= storage.matches.length) {
              storage.currentIndex = Math.max(0, storage.matches.length - 1);
            }
            // decoration 갱신을 위해 빈 트랜잭션 발행
            const refreshTr = editor.view.state.tr.setMeta(searchHighlightPluginKey, { refresh: true });
            editor.view.dispatch(refreshTr);
          });

          return true;
        },

      replaceAll:
        (replacement: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = this.storage;

          if (storage.matches.length === 0) {
            return false;
          }

          if (dispatch) {
            // 뒤에서부터 치환 (위치 변경 방지)
            const sortedMatches = [...storage.matches].sort((a, b) => b.from - a.from);

            for (const match of sortedMatches) {
              tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
            }

            dispatch(tr);
          }

          // 매치 재계산
          queueMicrotask(() => {
            storage.matches = findMatches(editor.state.doc, storage.searchTerm, storage.caseSensitive);
            storage.currentIndex = storage.matches.length > 0 ? 0 : -1;
            // decoration 갱신
            const refreshTr = editor.view.state.tr.setMeta(searchHighlightPluginKey, { refresh: true });
            editor.view.dispatch(refreshTr);
          });

          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          const storage = this.storage;
          storage.searchTerm = '';
          storage.matches = [];
          storage.currentIndex = -1;

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
              editor.commands.setTextSelection(match.from);
              editor.commands.scrollIntoView();
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

            if (meta?.refresh || tr.docChanged) {
              // 문서 변경 시 매치 재계산
              if (tr.docChanged && storage.searchTerm) {
                storage.matches = findMatches(newState.doc, storage.searchTerm, storage.caseSensitive);
                // 인덱스 범위 조정
                if (storage.currentIndex >= storage.matches.length) {
                  storage.currentIndex = Math.max(0, storage.matches.length - 1);
                }
                if (storage.matches.length === 0) {
                  storage.currentIndex = -1;
                }
              }

              return createSearchDecorations(
                newState.doc,
                storage.matches,
                storage.currentIndex,
                searchClass,
                currentClass
              );
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
