/**
 * buildAlignedChunks 비동기화 테스트
 *
 * TDD RED Phase: 비동기 함수로 변환할 예정
 * - 기존 동기 함수와 동일한 결과 반환
 * - 비동기로 동작 (메인 스레드 블로킹 방지)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITEProject, EditorBlock, SegmentGroup } from '@/types';

// 테스트용 프로젝트 생성 헬퍼
function createTestProject(segmentCount: number): ITEProject {
  const blocks: Record<string, EditorBlock> = {};
  const segments: SegmentGroup[] = [];
  const now = Date.now();

  for (let i = 0; i < segmentCount; i++) {
    const sourceBlockId = `source-${i}`;
    const targetBlockId = `target-${i}`;

    blocks[sourceBlockId] = {
      id: sourceBlockId,
      type: 'source',
      content: `<p>Source text for segment ${i}. This is a test paragraph with some content.</p>`,
      hash: `hash-source-${i}`,
      metadata: { createdAt: now, updatedAt: now, tags: [] },
    };

    blocks[targetBlockId] = {
      id: targetBlockId,
      type: 'target',
      content: `<p>번역된 텍스트 ${i}. 이것은 테스트 문단입니다.</p>`,
      hash: `hash-target-${i}`,
      metadata: { createdAt: now, updatedAt: now, tags: [] },
    };

    segments.push({
      groupId: `group-${i}`,
      order: i,
      sourceIds: [sourceBlockId],
      targetIds: [targetBlockId],
      isAligned: true,
    });
  }

  return {
    id: 'test-project',
    version: '1.0.0',
    metadata: {
      title: 'Test Project',
      domain: 'general',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: false,
        autoSaveInterval: 60000,
        theme: 'system',
      },
    },
    blocks,
    segments,
  };
}

describe('buildAlignedChunksAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('비동기 함수로 Promise를 반환해야 함', async () => {
    // 아직 구현되지 않은 비동기 함수를 import 시도
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(3);
    const result = buildAlignedChunksAsync(project);

    // Promise를 반환해야 함
    expect(result).toBeInstanceOf(Promise);

    const chunks = await result;
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('동기 함수와 동일한 결과를 반환해야 함', async () => {
    const { buildAlignedChunks, buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(5);

    const syncResult = buildAlignedChunks(project, 12000);
    const asyncResult = await buildAlignedChunksAsync(project, 12000);

    expect(asyncResult).toEqual(syncResult);
  });

  it('빈 프로젝트도 처리해야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');
    const now = Date.now();

    const emptyProject: ITEProject = {
      id: 'empty',
      version: '1.0.0',
      metadata: {
        title: 'Empty',
        domain: 'general',
        createdAt: now,
        updatedAt: now,
        settings: {
          strictnessLevel: 0.5,
          autoSave: false,
          autoSaveInterval: 60000,
          theme: 'system',
        },
      },
      blocks: {},
      segments: [],
    };

    const chunks = await buildAlignedChunksAsync(emptyProject);
    expect(chunks).toEqual([]);
  });

  it('큰 프로젝트에서 여러 청크로 분할해야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    // 100개 세그먼트 (각각 ~150자 = ~15,000자 → 2개 청크 예상)
    const project = createTestProject(100);
    const chunks = await buildAlignedChunksAsync(project, 12000);

    expect(chunks.length).toBeGreaterThan(1);

    // 모든 세그먼트가 포함되어야 함
    const totalSegments = chunks.reduce((sum, chunk) => sum + chunk.segments.length, 0);
    expect(totalSegments).toBe(100);
  });

  it('세그먼트 순서가 order 기준으로 정렬되어야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(10);
    // 순서를 섞음
    project.segments = project.segments.sort(() => Math.random() - 0.5);

    const chunks = await buildAlignedChunksAsync(project);

    // 결과에서 order가 순차적이어야 함
    let prevOrder = -1;
    for (const chunk of chunks) {
      for (const seg of chunk.segments) {
        expect(seg.order).toBeGreaterThan(prevOrder);
        prevOrder = seg.order;
      }
    }
  });

  it('AbortSignal로 취소할 수 있어야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(1000); // 큰 프로젝트
    const controller = new AbortController();

    // 즉시 취소
    controller.abort();

    await expect(
      buildAlignedChunksAsync(project, 12000, controller.signal)
    ).rejects.toThrow('Aborted');
  });

  it('청크 인덱스가 0부터 순차적으로 증가해야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(100);
    const chunks = await buildAlignedChunksAsync(project, 5000);

    chunks.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
    });
  });

  it('HTML 콘텐츠가 처리되어야 함', async () => {
    const { buildAlignedChunksAsync } = await import('./reviewTool');

    const project = createTestProject(1);
    // HTML 콘텐츠 추가
    project.blocks['source-0']!.content = '<h1>제목</h1><p><strong>굵은</strong> 텍스트</p>';

    const chunks = await buildAlignedChunksAsync(project);
    const firstSegment = chunks[0]?.segments[0];

    // sourceText가 존재하고 빈 문자열이 아님
    expect(firstSegment?.sourceText).toBeDefined();
    expect(firstSegment?.sourceText.length).toBeGreaterThan(0);
    // "제목" 또는 "굵은" 텍스트가 포함됨 (HTML이든 Markdown이든)
    expect(
      firstSegment?.sourceText.includes('제목') ||
      firstSegment?.sourceText.includes('굵은')
    ).toBe(true);
  });
});

describe('buildReviewPrompt', () => {
  it('excerpt와 suggestion에 서식 태그를 포함하지 않도록 지시한다', async () => {
    const { buildReviewPrompt } = await import('./reviewTool');
    const prompt = buildReviewPrompt();

    expect(prompt).toContain('HTML');
    expect(prompt).toContain('Markdown');
    expect(prompt).toContain('표시 텍스트만');
  });

  it('실제 UI와 동일한 3단계 심각도와 실행 가능한 이슈 기준을 사용한다', async () => {
    const { buildReviewPrompt } = await import('./reviewTool');
    const prompt = buildReviewPrompt();

    expect(prompt).toContain('Critical / Major / Minor');
    expect(prompt).not.toContain('1~5점');
    expect(prompt).toContain('유능한 원어민 편집자가 실제 출판 전에 수정할 표현');
    expect(prompt).toContain('동등하게 자연스러운 다른 표현은 이슈가 아닙니다');
    expect(prompt).toContain('뉘앙스나 톤이 달라지면 Mistranslation');
    expect(prompt).toContain('문법적으로 맞지만 번역투가 남아 있으면 Awkward');
  });

  it('하나의 교체 가능한 단위를 출력하고 사용하지 않는 summary를 요구하지 않는다', async () => {
    const { buildReviewPrompt } = await import('./reviewTool');
    const prompt = buildReviewPrompt();

    expect(prompt).toContain('하나의 교체 가능한 단위');
    expect(prompt).toContain('제목·UI 문자열·목록 항목·표 셀');
    expect(prompt).not.toContain('## Summary');
    expect(prompt).not.toContain('Verdict:');
    expect(prompt).toContain('NO_ISSUES');
  });
});
