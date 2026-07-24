/**
 * TipTap Plugin Key 중앙 관리
 *
 * 모든 TipTap Plugin Key를 한 곳에서 관리하여:
 * - 이름 중복 방지
 * - 다른 컴포넌트에서 재사용 시 쉬운 접근
 * - Plugin 등록 순서 명확화
 */

import { PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import type { SelectionAnchorPluginState } from '@/editor/extensions/SelectionAnchor';

export const pluginKeys = {
  reviewHighlight: new PluginKey<DecorationSet>('reviewHighlight'),
  searchHighlight: new PluginKey<DecorationSet>('searchHighlight'),
  selectionAnchor: new PluginKey<SelectionAnchorPluginState>('selectionAnchor'),
} as const;
