import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { isTauriRuntime } from '@/tauri/invoke';
import { braveSearch } from '@/tauri/braveSearch';

interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

/**
 * Brave Search API를 호출하여 웹 검색 결과를 가져옵니다.
 * Tauri 백엔드(Command)를 통해 호출하므로 CORS 문제를 우회합니다.
 */
async function searchBrave(query: string, count?: number): Promise<BraveSearchResult[]> {
  if (!isTauriRuntime()) {
    console.warn('[BraveSearch] Not in Tauri runtime. Skipping search.');
    throw new Error('Brave search is only supported in Tauri runtime (CORS restriction in browser).');
  }

  try {
    const results = await braveSearch({ query, count: count ?? 5 });
    return results.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description ?? '',
    }));
  } catch (error) {
    console.error('[BraveSearch] API call failed:', error);
    throw new Error(`Brave Search API 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const BraveSearchToolArgsSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('검색할 키워드 또는 질문. (예: "React 19 새로운 기능", "Next.js 14 server actions 예제")'),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
    .describe('반환할 검색 결과의 개수 (1~10, 기본값: 5)'),
});

export const braveSearchTool = tool(
  async (args) => {
    // tool() 함수가 zod validation을 통과한 데이터를 넘겨주지만,
    // 혹시 모를 상황에 대비해 방어적으로 처리
    const query = args.query;
    const count = args.count ?? 5;

    if (!query || query.trim().length === 0) {
      return '검색어(query)가 비어있습니다.';
    }

    try {
      const results = await searchBrave(query, count);

      if (results.length === 0) {
        return `"${query}"에 대한 검색 결과가 없습니다. 다른 키워드로 시도해보세요.`;
      }

      // 검색 결과를 LLM이 이해하기 쉬운 Markdown 포맷으로 변환
      const formattedResults = results
        .map((r, idx) => {
          const desc = r.description ? `\n   ${r.description}` : '';
          return `${idx + 1}. [${r.title}](${r.url})${desc}`;
        })
        .join('\n\n');

      return `## Brave Search 결과 ("${query}")\n\n${formattedResults}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      return `검색 중 오류가 발생했습니다: ${message}\n(API 키가 올바르게 설정되었는지 확인하세요)`;
    }
  },
  {
    name: 'brave_search',
    description: `웹 검색을 통해 최신 정보, 뉴스, 기술 문서, 용어 정의 등을 찾아야 할 때 사용합니다.
단순 번역이 아니라, "최신 트렌드", "라이브러리 사용법", "특정 용어의 실제 쓰임새" 등을 확인해야 할 때 유용합니다.
결과는 Markdown 링크 형식으로 반환됩니다.`,
    schema: BraveSearchToolArgsSchema,
  }
);
