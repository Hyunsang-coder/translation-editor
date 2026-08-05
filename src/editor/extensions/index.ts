/**
 * TipTap 커스텀 확장 모음
 * 블록 기반 번역 에디터를 위한 확장들
 */

export { GhostChipExtension } from './GhostChip';
export { DiffMarkExtension } from './DiffMark';
export {
  AppliedChangeHighlight,
  hasAppliedChangeHighlights,
  markAppliedChanges,
} from './AppliedChangeHighlight';
export type { AppliedChangeRange } from './AppliedChangeHighlight';
export { SearchHighlight, getSearchState } from './SearchHighlight';
export type { SearchMatch, SearchState, SearchHighlightOptions, SearchHighlightStorage } from './SearchHighlight';
export { ImagePlaceholder, ImageOriginal } from './ImagePlaceholder';
export {
  SelectionAnchor,
  clearSelectionAnchors,
  createSelectionAnchor,
  markSelectionAnchorStale,
  removeSelectionAnchor,
  resolveSelectionAnchor,
} from './SelectionAnchor';
export type {
  CreateSelectionAnchorInput,
  SelectionAnchorPluginState,
  SelectionAnchorRecord,
} from './SelectionAnchor';
export {
  TranslationUnitId,
  collectTranslationUnits,
  ensureTranslationUnitIds,
  getTranslationUnitIdsAtRange,
  reattachTranslationUnitIds,
} from './TranslationUnitId';
export type {
  TranslationUnit,
  TranslationUnitDocument,
  TranslationUnitReattachmentResult,
} from './TranslationUnitId';
export { pluginKeys } from '@/editor/plugins/pluginKeys';
// Backward compatibility: searchHighlightPluginKey는 pluginKeys.searchHighlight로 접근
export { searchHighlightPluginKey } from './SearchHighlight';
