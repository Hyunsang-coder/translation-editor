import type { SearchMatch } from '@/editor/extensions/SearchHighlight';
import { filterMatchesInRange } from '@/editor/extensions/SearchHighlight';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function normalizeSegmentGroupId(segmentGroupId: string | undefined): string | undefined {
  if (!segmentGroupId) return undefined;
  return segmentGroupId.startsWith('#') ? segmentGroupId.slice(1) : segmentGroupId;
}

export function hasSegmentGroupId(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.attrs?.segmentGroupId) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

export function filterMatchesBySegment(
  matches: SearchMatch[],
  segmentRange: { from: number; to: number } | null,
  requireSegmentRange: boolean,
  hasSegmentGroups: boolean,
): SearchMatch[] {
  if (!requireSegmentRange) return matches;
  if (!segmentRange) return hasSegmentGroups && matches.length > 1 ? [] : matches;
  return filterMatchesInRange(matches, segmentRange);
}
