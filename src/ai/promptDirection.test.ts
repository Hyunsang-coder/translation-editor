/**
 * 시스템 프롬프트의 번역 방향 줄 (`언어: X → Y`) 고정.
 *
 * 채팅은 토큰 최적화로 원문 문서를 인라인하지 않는데, 종전에는 그 `sourceDocument`를
 * 방향 판정 표본으로도 썼다 — 그래서 자동 방향 프로젝트의 채팅 프롬프트가 **언제나**
 * `언어: Source → Target`이었고 아무 테스트도 그걸 잡지 못했다 (ADR-0021).
 */
import { describe, it, expect } from 'vitest';
import { buildLangChainMessages } from '@/ai/prompt';
import type { ITEProject } from '@/types';

const project = {
  id: 'p', version: '1.0.0', segments: [], blocks: {},
  metadata: { title: 't', domain: 'game', createdAt: 0, updatedAt: 0,
    settings: { strictnessLevel: 0.5, autoSave: true, autoSaveInterval: 30000, theme: 'system' } },
} as unknown as ITEProject;

const KO = '이번 업데이트에서 보급 상자 스폰 규칙을 변경합니다.';

async function sys(ctx: Record<string, unknown>): Promise<string> {
  const msgs = await buildLangChainMessages({ project, userMessage: '안녕', contextBlocks: [], recentMessages: [], ...ctx } as never);
  return String(msgs[0]?.content ?? '');
}

describe('프롬프트 방향', () => {
  it('표본을 주면 실제 방향이 실린다', async () => {
    expect(await sys({ sourceSample: KO })).toContain('언어: 한국어 → 영어');
  });

  it('표본이 없으면 종전 자리표시자로 떨어진다 (회귀 아님)', async () => {
    expect(await sys({})).toContain('언어: Source → Target');
  });

  it('sourceSample은 문서를 인라인하지 않는다 — 토큰 최적화가 무너지면 안 된다', async () => {
    const out = await sys({ sourceSample: KO });
    expect(out).not.toContain('보급 상자 스폰 규칙');
  });
});
