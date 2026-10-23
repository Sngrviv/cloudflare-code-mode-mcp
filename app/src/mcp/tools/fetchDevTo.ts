// src/mcp/tools/fetchDevTo.ts
// Fetches latest tech articles from Dev.to public API (no auth needed for read)

import axios from 'axios';
import type { Article, FetchOptions, ToolResult } from '../types.js';

const DEVTO_BASE = 'https://dev.to/api';

interface DevToArticle {
  id: number;
  title: string;
  url: string;
  positive_reactions_count: number;
  comments_count: number;
  user: { name: string };
  published_at: string;
  tag_list: string[];
  description: string;
}

export async function fetchDevTo(
  options: FetchOptions = {}
): Promise<ToolResult<Article[]>> {
  const limit = options.limit ?? 10;
  const perPage = Math.min(limit * 2, 30);

  const params: Record<string, string | number> = {
    per_page: perPage,
    top: 7, // top articles of the last 7 days
  };

  // If tags provided, use the first tag as the primary filter
  if (options.tags?.length) {
    params.tag = options.tags[0];
  }

  const res = await axios.get<DevToArticle[]>(`${DEVTO_BASE}/articles`, {
    params,
    timeout: 8000,
    headers: {
      'User-Agent': 'TechNewsAgent/1.0 (learning project)',
    },
  });

  const articles: Article[] = res.data
    .filter((a) => a.positive_reactions_count >= (options.minScore ?? 0))
    .slice(0, limit)
    .map((a) => ({
      id: `devto-${a.id}`,
      title: a.title,
      url: a.url,
      source: 'devto' as const,
      score: a.positive_reactions_count,
      comments: a.comments_count,
      author: a.user?.name ?? 'Unknown',
      publishedAt: a.published_at,
      tags: Array.isArray(a.tag_list) ? a.tag_list : [],
      summary: a.description ?? '',
    }));

  // Apply additional tag filters
  const filtered =
    options.tags && options.tags.length > 1
      ? articles.filter((a) =>
          options.tags!.some(
            (tag) =>
              a.tags.includes(tag.toLowerCase()) ||
              a.title.toLowerCase().includes(tag.toLowerCase())
          )
        )
      : articles;

  return {
    data: filtered,
    meta: {
      source: 'Dev.to Public API',
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
    },
  };
}
