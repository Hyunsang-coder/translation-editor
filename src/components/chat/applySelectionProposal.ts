import type { Editor } from '@tiptap/react';
import {
  getSingleAnchorRange,
  readAnchorText,
  resolveSelectionAnchor,
} from '@/editor/extensions/SelectionAnchor';
import { applySelectionEdit } from '@/editor/utils/applySelectionEdit';
import { collectCommentIdsInRange } from '@/editor/utils/commentNavigation';

export type ApplySelectionProposalOutcome =
  | {
      status: 'applied';
      /** 서식이 섞여 공통 서식으로 평탄화했다 — 사용자에게 알려야 한다. */
      flattened: boolean;
      /** 교체 범위에 걸려 있던 코멘트. 발췌 동기화 대상. */
      affectedCommentIds: string[];
    }
  | { status: 'stale' };

/**
 * 채팅 수정안을 Target 문서에 적용한다. 앵커 검증부터 서식 평탄화 재시도까지의
 * 판단만 담고, 스토어·토스트 같은 부수효과는 호출부(ChatContent)가 맡는다.
 */
export function applySelectionProposal(
  editor: Editor,
  proposal: {
    anchorId: string;
    originalText: string;
    replacementText: string;
  },
): ApplySelectionProposalOutcome {
  const anchor = resolveSelectionAnchor(editor, proposal.anchorId);
  const anchorRange = anchor ? getSingleAnchorRange(anchor) : null;
  if (
    !anchor ||
    !anchorRange ||
    anchor.status !== 'active' ||
    readAnchorText(editor.state.doc, anchorRange.from, anchorRange.to)
      !== proposal.originalText
  ) {
    return { status: 'stale' };
  }

  // 교체 전에 모아야 한다 — 적용 후에는 마크가 사라져 무엇이 걸려 있었는지 알 수 없다.
  const affectedCommentIds = collectCommentIdsInRange(
    editor.state.doc,
    anchorRange.from,
    anchorRange.to,
  );
  const applyOnce = (flattenFormatting: boolean): ReturnType<typeof applySelectionEdit> =>
    applySelectionEdit(editor, anchor, proposal.replacementText, {
      // 앵커 텍스트는 편집을 따라 재기준화되므로, 수정안 생성 시점의 스냅샷을
      // 기준으로 검증해야 사용자 편집을 덮어쓰지 않는다.
      expectedText: proposal.originalText,
      ...(flattenFormatting ? { flattenFormatting } : {}),
    });

  // 서식이 섞인 범위는 막지 않고 공통 서식으로 평탄화해 적용한다. 평탄화 판정은
  // 트랜잭션을 만들기 전에 끝나므로(applySelectionEdit) 실패한 1차 시도는 문서에
  // 아무것도 남기지 않아 그대로 재시도할 수 있다.
  const first = applyOnce(false);
  if (first === 'applied') {
    return { status: 'applied', flattened: false, affectedCommentIds };
  }
  if (first !== 'formatting-conflict') return { status: 'stale' };

  return applyOnce(true) === 'applied'
    ? { status: 'applied', flattened: true, affectedCommentIds }
    : { status: 'stale' };
}
