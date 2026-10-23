import type { Article, SearchOptions, ToolResult } from '../types.js';
import { articleStore } from '../articleStore.js';

export function updateCache(articles: Article[]): void {
  articleStore.addArticles(articles);
}

export function getCacheSize(): number {
  return articleStore.size();
}

export async function searchNews(
  options: SearchOptions
): Promise<ToolResult<Article[]>> {
  const scored = articleStore.search(options);

  return {
    data: scored,
    meta: {
      source: 'In-memory article store',
      fetchedAt: new Date().toISOString(),
      count: scored.length,
    },
  };
}
