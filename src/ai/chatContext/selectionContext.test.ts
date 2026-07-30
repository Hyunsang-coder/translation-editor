import { describe, expect, it } from 'vitest';
import type { ChatMessage, SelectionContext } from '@/types';
import {
  filterMessagesForSelectionScope,
  toChatSelectionSnapshot,
} from './selectionContext';

const selection: SelectionContext = {
  selectionId: 'selection-1',
  selectionScopeId: 'scope-2',
  projectId: 'project-1',
  panel: 'target',
  text: '선택 문장',
  from: 5,
  to: 10,
  anchorId: 'anchor-1',
  translationUnitIds: ['unit-1'],
  documentRevision: 'revision-1',
  status: 'active',
  spansMultipleBlocks: false,
  createdAt: 1,
};

describe('selection chat context', () => {
  it('runtime 위치를 제외한 메시지 snapshot을 만든다', () => {
    expect(toChatSelectionSnapshot(selection)).toEqual({
      selectionId: 'selection-1',
      selectionScopeId: 'scope-2',
      projectId: 'project-1',
      panel: 'target',
      text: '선택 문장',
      translationUnitIds: ['unit-1'],
      documentRevision: 'revision-1',
      anchorStatusAtSend: 'active',
    });
  });

  it('현재 selection scope의 메시지만 모델 history로 남긴다', () => {
    const message = (
      id: string,
      scope?: string,
    ): ChatMessage => ({
      id,
      role: id.startsWith('u') ? 'user' : 'assistant',
      content: id,
      timestamp: 1,
      ...(scope ? { metadata: { selectionScopeId: scope } } : {}),
    });
    const messages = [
      message('u-general'),
      message('u-scope-1', 'scope-1'),
      message('a-scope-1', 'scope-1'),
      message('u-scope-2', 'scope-2'),
      message('a-scope-2', 'scope-2'),
    ];

    expect(filterMessagesForSelectionScope(messages, 'scope-2').map((item) => item.id))
      .toEqual(['u-scope-2', 'a-scope-2']);
  });
});
