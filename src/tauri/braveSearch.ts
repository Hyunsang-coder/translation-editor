import { invoke } from '@/tauri/invoke';

export interface BraveSearchResultDto {
  title: string;
  url: string;
  description?: string;
}

export async function braveSearch(params: { query: string; count?: number }): Promise<BraveSearchResultDto[]> {
  return await invoke<BraveSearchResultDto[]>('brave_search', {
    args: {
      query: params.query,
      count: params.count ?? 5,
    },
  });
}



