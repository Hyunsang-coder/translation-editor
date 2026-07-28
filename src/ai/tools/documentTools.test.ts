import { describe, it, expect, vi } from 'vitest';
import { getSourceDocumentTool, getTargetDocumentTool, renderDocumentToolOutput } from './documentTools';
import { getChatToolDescriptor } from './toolRegistry';

const BASE64_SRC = `data:image/png;base64,${'A'.repeat(12_000)}`;

const docWithImage = (text: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'image', attrs: { src: BASE64_SRC, alt: 'diagram', title: null } },
  ],
});

vi.mock('@/stores/projectStore', () => ({
  flushPendingEditorSyncs: vi.fn(),
  useProjectStore: {
    getState: () => ({
      project: { id: 'p1' },
      sourceDocJson: docWithImage('원문 본문입니다.'),
      targetDocJson: docWithImage('번역문 본문입니다.'),
      sourceDocument: '',
      targetDocument: '',
    }),
  },
}));

const SOURCE_CAP = getChatToolDescriptor('get_source_document')!.maxOutputChars!;
const TARGET_CAP = getChatToolDescriptor('get_target_document')!.maxOutputChars!;

describe('renderDocumentToolOutput (신뢰경계 래핑 포함 출력 예산)', () => {
  it('긴 문서도 래퍼 포함 registry maxOutputChars 이내로 반환한다', () => {
    const huge = '가'.repeat(20_000);
    const out = renderDocumentToolOutput(huge, {}, 'get_source_document');
    // chat.ts가 이 길이를 초과하면 꼬리를 잘라 </untrusted> 태그가 유실되고
    // "[도구 결과가 제한 길이에서 잘렸습니다.]" 표식이 모델의 재조회를 유발한다.
    expect(out.length).toBeLessThanOrEqual(SOURCE_CAP);
    expect(out.endsWith('</untrusted>')).toBe(true);
  });

  it('모델이 큰 maxChars를 요청해도 registry cap을 넘지 않는다', () => {
    const huge = 'A'.repeat(30_000);
    const out = renderDocumentToolOutput(huge, { maxChars: 20_000 }, 'get_target_document');
    expect(out.length).toBeLessThanOrEqual(TARGET_CAP);
    expect(out.endsWith('</untrusted>')).toBe(true);
  });

  it('짧은 문서는 전문이 보존된다', () => {
    const doc = '# 제목\n\n짧은 본문입니다.';
    const out = renderDocumentToolOutput(doc, {}, 'get_source_document');
    expect(out).toContain(doc);
    expect(out.endsWith('</untrusted>')).toBe(true);
  });

  it('작은 maxChars 요청은 그대로 존중한다', () => {
    const doc = 'B'.repeat(5_000);
    const out = renderDocumentToolOutput(doc, { maxChars: 2_000 }, 'get_source_document');
    // 본문이 2000자 수준으로 잘리고(head+tail), 래퍼가 붙는다
    expect(out.length).toBeLessThan(3_000);
    expect(out.endsWith('</untrusted>')).toBe(true);
  });
});

describe('문서 도구 출력에서 이미지 제거', () => {
  // 문서에 박힌 base64 이미지는 vision 입력이 아니라 그냥 긴 문자열이라
  // 모델이 보지도 못하면서 maxOutputChars 예산만 먹고 본문을 밀어낸다.
  it('get_source_document는 base64 이미지를 내보내지 않는다', async () => {
    const out = (await getSourceDocumentTool.invoke({})) as string;
    expect(out).not.toContain('data:image');
    expect(out).toContain('원문 본문입니다.');
  });

  it('get_target_document는 base64 이미지를 내보내지 않는다', async () => {
    const out = (await getTargetDocumentTool.invoke({})) as string;
    expect(out).not.toContain('data:image');
    expect(out).toContain('번역문 본문입니다.');
  });
});
