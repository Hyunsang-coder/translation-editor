import type {
  ChatMessageMetadata,
  ForbiddenTermProposal,
  GlossaryEntryProposal,
  ProjectMemoryChangeProposal,
} from '@/types';

export type KnowledgeProposalKind = 'memory' | 'forbiddenTerm' | 'glossaryEntry';

type AnyProposal = {
  proposalId: string;
  status: 'proposed' | 'applied' | 'dismissed';
};

/**
 * 배열 필드와 legacy 단수 필드를 하나의 목록으로 정규화한다.
 * 2026-07-27 이전 메시지는 단수 필드만 갖고 있다.
 */
function normalize<T extends AnyProposal>(list: T[] | undefined, single: T | undefined): T[] {
  if (list && list.length > 0) return list;
  return single ? [single] : [];
}

/**
 * 저장된 제안의 operation을 현재 시맨틱으로 정규화한다.
 * 2026-07-28 이전 메시지는 삭제 제안을 'archive'로 저장했다.
 */
function normalizeOperation(
  proposal: ProjectMemoryChangeProposal,
): ProjectMemoryChangeProposal {
  return (proposal.operation as string) === 'archive'
    ? { ...proposal, operation: 'delete' }
    : proposal;
}

export function readMemoryProposals(
  metadata?: ChatMessageMetadata,
): ProjectMemoryChangeProposal[] {
  return normalize(
    metadata?.projectMemoryProposals,
    metadata?.projectMemoryProposal,
  ).map(normalizeOperation);
}

export function readForbiddenTermProposals(
  metadata?: ChatMessageMetadata,
): ForbiddenTermProposal[] {
  return normalize(metadata?.forbiddenTermProposals, metadata?.forbiddenTermProposal);
}

export function readGlossaryEntryProposals(
  metadata?: ChatMessageMetadata,
): GlossaryEntryProposal[] {
  return normalize(metadata?.glossaryEntryProposals, metadata?.glossaryEntryProposal);
}

function patch<T extends AnyProposal>(
  list: T[] | undefined,
  single: T | undefined,
  proposalId: string,
  status: 'applied' | 'dismissed',
): { list: T[] } | { single: T } | null {
  if (list?.some((candidate) => candidate.proposalId === proposalId)) {
    return {
      list: list.map((candidate) =>
        candidate.proposalId === proposalId ? { ...candidate, status } : candidate,
      ),
    };
  }
  if (single?.proposalId === proposalId) return { single: { ...single, status } };
  return null;
}

/**
 * 해당 proposalId의 status만 바꾼 metadata patch를 만든다.
 * 대상을 찾지 못하면 null을 반환해 호출부가 불필요한 업데이트를 건너뛰게 한다.
 */
export function patchProposalStatus(
  metadata: ChatMessageMetadata | undefined,
  kind: KnowledgeProposalKind,
  proposalId: string,
  status: 'applied' | 'dismissed',
): Partial<ChatMessageMetadata> | null {
  if (kind === 'memory') {
    const result = patch(
      metadata?.projectMemoryProposals,
      metadata?.projectMemoryProposal,
      proposalId,
      status,
    );
    if (!result) return null;
    return 'list' in result
      ? { projectMemoryProposals: result.list }
      : { projectMemoryProposal: result.single };
  }
  if (kind === 'forbiddenTerm') {
    const result = patch(
      metadata?.forbiddenTermProposals,
      metadata?.forbiddenTermProposal,
      proposalId,
      status,
    );
    if (!result) return null;
    return 'list' in result
      ? { forbiddenTermProposals: result.list }
      : { forbiddenTermProposal: result.single };
  }
  const result = patch(
    metadata?.glossaryEntryProposals,
    metadata?.glossaryEntryProposal,
    proposalId,
    status,
  );
  if (!result) return null;
  return 'list' in result
    ? { glossaryEntryProposals: result.list }
    : { glossaryEntryProposal: result.single };
}
