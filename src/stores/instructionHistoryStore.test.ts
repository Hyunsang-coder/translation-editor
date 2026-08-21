import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECENT_INSTRUCTIONS,
  selectRecentInstructions,
  useInstructionHistoryStore,
} from './instructionHistoryStore';

function record(projectId: string | undefined, instruction: string): void {
  useInstructionHistoryStore.getState().recordInstruction(projectId, 'documentPolish', instruction);
}

function recent(projectId: string | undefined): readonly string[] {
  return selectRecentInstructions(useInstructionHistoryStore.getState(), projectId, 'documentPolish');
}

describe('instructionHistoryStore', () => {
  beforeEach(() => {
    useInstructionHistoryStore.setState({ byProject: {} });
  });

  it('최신이 앞에 오고 상한을 넘으면 오래된 것부터 밀려난다', () => {
    for (let i = 1; i <= MAX_RECENT_INSTRUCTIONS + 2; i += 1) record('p1', `지시 ${i}`);

    expect(recent('p1')).toHaveLength(MAX_RECENT_INSTRUCTIONS);
    expect(recent('p1')[0]).toBe(`지시 ${MAX_RECENT_INSTRUCTIONS + 2}`);
    expect(recent('p1')).not.toContain('지시 1');
  });

  it('같은 문장을 다시 쓰면 새 항목이 아니라 맨 앞으로 올라온다', () => {
    record('p1', '더 간결하게');
    record('p1', '존댓말 유지');
    record('p1', '더 간결하게');

    expect(recent('p1')).toEqual(['더 간결하게', '존댓말 유지']);
  });

  it('앞뒤 공백만 다른 문장은 같은 항목이고, 빈 문장은 남기지 않는다', () => {
    record('p1', '  더 간결하게  ');
    record('p1', '더 간결하게');
    record('p1', '   ');

    expect(recent('p1')).toEqual(['더 간결하게']);
  });

  it('프로젝트끼리 섞이지 않는다', () => {
    record('p1', '프로젝트1 지시');
    record('p2', '프로젝트2 지시');

    expect(recent('p1')).toEqual(['프로젝트1 지시']);
    expect(recent('p2')).toEqual(['프로젝트2 지시']);
  });

  it('용도끼리 섞이지 않는다', () => {
    const { recordInstruction } = useInstructionHistoryStore.getState();
    recordInstruction('p1', 'documentPolish', '더 격식체로');
    recordInstruction('p1', 'review', '용어 일관성 위주로');

    expect(recent('p1')).toEqual(['더 격식체로']);
    expect(
      selectRecentInstructions(useInstructionHistoryStore.getState(), 'p1', 'review'),
    ).toEqual(['용어 일관성 위주로']);
  });

  it('프로젝트가 없으면 기록하지 않고 빈 목록을 준다', () => {
    record(undefined, '어디에도 안 남을 지시');

    expect(useInstructionHistoryStore.getState().byProject).toEqual({});
    expect(recent(undefined)).toEqual([]);
  });

  it('한 항목만 지우면 나머지는 순서를 지킨다', () => {
    record('p1', '첫째');
    record('p1', '둘째');
    record('p1', '셋째');

    useInstructionHistoryStore.getState().removeInstruction('p1', 'documentPolish', '둘째');

    expect(recent('p1')).toEqual(['셋째', '첫째']);
  });

  it('없는 항목을 지워도 상태 참조가 바뀌지 않는다 (불필요한 리렌더 방지)', () => {
    record('p1', '첫째');
    const before = useInstructionHistoryStore.getState().byProject;

    useInstructionHistoryStore.getState().removeInstruction('p1', 'documentPolish', '없는 것');

    expect(useInstructionHistoryStore.getState().byProject).toBe(before);
  });

  it('프로젝트를 지우면 그 프로젝트 기록만 사라진다', () => {
    record('p1', '지울 것');
    record('p2', '남을 것');

    useInstructionHistoryStore.getState().forgetProject('p1');

    expect(recent('p1')).toEqual([]);
    expect(recent('p2')).toEqual(['남을 것']);
  });
});
