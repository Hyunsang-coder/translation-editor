import { invoke } from '@/tauri/invoke';
import { getAiConfig } from '@/ai/config';
import i18n from '@/i18n/config';

export interface BraveSearchResultDto {
  title: string;
  url: string;
  description?: string;
}

export async function braveSearch(params: { query: string; count?: number }): Promise<BraveSearchResultDto[]> {
  const cfg = getAiConfig();
  const apiKey = cfg.braveApiKey;

  if (!apiKey) {
    throw new Error(i18n.t('errors.braveApiKeyMissing'));
  }

  return await invoke<BraveSearchResultDto[]>('brave_search', {
    args: {
      query: params.query,
      count: params.count ?? 5,
      apiKey,
    },
  });
}




