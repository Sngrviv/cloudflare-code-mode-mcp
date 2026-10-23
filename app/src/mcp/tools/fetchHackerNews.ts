// src/mcp/tools/fetchHackerNews.ts
// Fetches top stories from Hacker News via the public Firebase API (no auth needed)

import axios from 'axios';
import type { Article, FetchOptions, ToolResult } from '../types.js';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  descendants?: number;
  by: string;
  time: number;
  type: string;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await axios.get<HNItem>(`${HN_BASE}/item/${id}.json`, { timeout: 5000 });
    return res.data;
  } catch {
    return null;
  }
}

export async function fetchHackerNews(
  options: FetchOptions = {}
): Promise<ToolResult<Article[]>> {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 0;

  // Get top story IDs (returns up to 500)
  const idsRes = await axios.get<number[]>(`${HN_BASE}/topstories.json`, { timeout: 8000 });
  const topIds = idsRes.data.slice(0, Math.min(limit * 3, 60)); // fetch 3x to allow filtering

  // Fetch items in parallel (capped at 20 concurrent)
  const items = await Promise.all(topIds.map(fetchItem));

  const articles: Article[] = items
    .filter((item): item is HNItem => item !== null && item.type === 'story' && !!item.title)
    .filter((item) => item.score >= minScore)
    .slice(0, limit)
    .map((item) => ({
      id: `hn-${item.id}`,
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      source: 'hackernews' as const,
      score: item.score,
      comments: item.descendants ?? 0,
      author: item.by,
      publishedAt: new Date(item.time * 1000).toISOString(),
      tags: [],
    }));

  // Apply tag filter if provided
  const filtered = options.tags?.length
    ? articles.filter((a) =>
        options.tags!.some((tag) => a.title.toLowerCase().includes(tag.toLowerCase()))
      )
    : articles;

  return {
    data: filtered,
    meta: {
      source: 'Hacker News (Firebase API)',
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
    },
  };
}
