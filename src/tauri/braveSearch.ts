import { invoke } from '@/tauri/invoke';
import { getAiConfig } from '@/ai/config';

export interface BraveSearchResultDto {
  title: string;
  url: string;
  description?: string;
}

export async function braveSearch(params: { query: string; count?: number }): Promise<BraveSearchResultDto[]> {
  const cfg = getAiConfig();
  const apiKey = cfg.braveApiKey;

  if (!apiKey) {
    throw new Error('Brave Search API key is missing. Please set it in App Settings.');
  }

  return await invoke<BraveSearchResultDto[]>('brave_search', {
    args: {
      query: params.query,
      count: params.count ?? 5,
      apiKey,
    },
  });
}




