import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyNotionToken } from './notionTools';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('verifyNotionToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notion_search 성공 시 true 반환', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({
      results: [],
    }));

    const result = await verifyNotionToken();

    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith('notion_search', {
      query: '',
      filter: undefined,
      pageSize: 1,
    });
  });

  it('notion_search 결과가 있어도 true 반환', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({
      results: [
        {
          id: 'page-123',
          object: 'page',
          url: 'https://notion.so/page',
        },
      ],
    }));

    const result = await verifyNotionToken();

    expect(result).toBe(true);
  });

  it('notion_search 401 Unauthorized → false 반환', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('Unauthorized (401)')
    );

    const result = await verifyNotionToken();

    expect(result).toBe(false);
  });

  it('notion_search 403 Forbidden → false 반환', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('Forbidden (403): Invalid token')
    );

    const result = await verifyNotionToken();

    expect(result).toBe(false);
  });

  it('notion_search 네트워크 타임아웃 → false 반환', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('Request timeout')
    );

    const result = await verifyNotionToken();

    expect(result).toBe(false);
  });

  it('notion_search 예상치 못한 에러 → false 반환', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('Internal server error (500)')
    );

    const result = await verifyNotionToken();

    expect(result).toBe(false);
  });

  it('notion_search 에러 객체가 아닌 값 → false 반환', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Unknown error');

    const result = await verifyNotionToken();

    expect(result).toBe(false);
  });

  it('빈 쿼리로 notion_search 호출 (쿼리 내용 무시)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ results: [] }));

    await verifyNotionToken();

    // 첫 번째 인자는 command 이름, 두 번째는 인자
    const [command, args] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe('notion_search');
    expect(args.query).toBe('');
    expect(args.pageSize).toBe(1);
  });

  it('여러 번 호출 시 각각 독립적으로 동작', async () => {
    // 첫 번째: 성공
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ results: [] }));
    const result1 = await verifyNotionToken();
    expect(result1).toBe(true);

    // 두 번째: 실패
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Unauthorized'));
    const result2 = await verifyNotionToken();
    expect(result2).toBe(false);

    // 세 번째: 성공
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ results: [] }));
    const result3 = await verifyNotionToken();
    expect(result3).toBe(true);

    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
