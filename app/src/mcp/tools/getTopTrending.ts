import type { Article, TrendingOptions, ToolResult } from '../types.js';
import { articleStore } from '../articleStore.js';

export function setTrendingCache(articles: Article[]): void {
  articleStore.addArticles(articles);
}

export async function getTopTrending(
  options: TrendingOptions = {}
): Promise<ToolResult<Array<Article & { trendingScore: number }>>> {
  const ranked = articleStore.getTrending(options);

  return {
    data: ranked,
    meta: {
      source: `All sources (last ${options.windowHours ?? 24}h)`,
      fetchedAt: new Date().toISOString(),
      count: ranked.length,
    },
  };
}
