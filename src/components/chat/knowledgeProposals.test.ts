import { describe, it, expect } from 'vitest';
import type { ChatMessageMetadata, ProjectMemoryChangeProposal } from '@/types';
import {
  patchProposalStatus,
  readForbiddenTermProposals,
  readGlossaryEntryProposals,
  readMemoryProposals,
} from './knowledgeProposals';

function memoryProposal(
  proposalId: string,
  overrides: Partial<ProjectMemoryChangeProposal> = {},
): ProjectMemoryChangeProposal {
  return {
    proposalId,
    operation: 'add',
    category: 'general',
    content: `content-${proposalId}`,
    sourceSessionId: 'session-1',
    status: 'proposed',
    ...overrides,
  };
}

describe('readMemoryProposals', () => {
  it('배열 필드를 그대로 돌려준다', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposals: [memoryProposal('p1'), memoryProposal('p2')],
    };
    expect(readMemoryProposals(metadata).map((p) => p.proposalId)).toEqual(['p1', 'p2']);
  });

  it('legacy 단수 필드를 목록으로 정규화한다', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposal: memoryProposal('legacy'),
    };
    expect(readMemoryProposals(metadata).map((p) => p.proposalId)).toEqual(['legacy']);
  });

  it('제안이 없으면 빈 배열', () => {
    expect(readMemoryProposals(undefined)).toEqual([]);
    expect(readMemoryProposals({})).toEqual([]);
  });

  it('금칙어/용어집도 같은 규칙을 따른다', () => {
    const metadata: ChatMessageMetadata = {
      forbiddenTermProposal: { proposalId: 'f1', term: '유저', status: 'proposed' },
      glossaryEntryProposals: [
        { proposalId: 'g1', source: 'quest', target: '퀘스트', status: 'proposed' },
      ],
    };
    expect(readForbiddenTermProposals(metadata).map((p) => p.proposalId)).toEqual(['f1']);
    expect(readGlossaryEntryProposals(metadata).map((p) => p.proposalId)).toEqual(['g1']);
  });
});

describe('patchProposalStatus', () => {
  it('배열에서 해당 proposalId만 갱신한다', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposals: [memoryProposal('p1'), memoryProposal('p2')],
    };
    const patch = patchProposalStatus(metadata, 'memory', 'p2', 'applied');
    expect(patch?.projectMemoryProposals?.map((p) => p.status)).toEqual(['proposed', 'applied']);
  });

  it('legacy 단수 필드는 단수 필드로 갱신한다', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposal: memoryProposal('legacy'),
    };
    const patch = patchProposalStatus(metadata, 'memory', 'legacy', 'dismissed');
    expect(patch?.projectMemoryProposal?.status).toBe('dismissed');
    expect(patch?.projectMemoryProposals).toBeUndefined();
  });

  it('대상을 못 찾으면 null', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposals: [memoryProposal('p1')],
    };
    expect(patchProposalStatus(metadata, 'memory', 'missing', 'applied')).toBeNull();
    expect(patchProposalStatus(undefined, 'memory', 'p1', 'applied')).toBeNull();
  });

  it('다른 종류의 제안은 건드리지 않는다', () => {
    const metadata: ChatMessageMetadata = {
      projectMemoryProposals: [memoryProposal('p1')],
      forbiddenTermProposals: [{ proposalId: 'f1', term: '유저', status: 'proposed' }],
    };
    const patch = patchProposalStatus(metadata, 'forbiddenTerm', 'f1', 'applied');
    expect(patch?.forbiddenTermProposals?.[0]?.status).toBe('applied');
    expect(patch?.projectMemoryProposals).toBeUndefined();
  });
});
