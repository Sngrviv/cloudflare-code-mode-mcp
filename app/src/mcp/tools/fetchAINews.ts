// src/mcp/tools/fetchAINews.ts
// Fetches AI/ML news by querying HN for AI-related top stories
// Uses HN search API (Algolia) which is free and no-auth

import axios from 'axios';
import type { Article, FetchOptions, ToolResult } from '../types.js';

const HN_SEARCH = 'https://hn.algolia.com/api/v1';

interface HNAlgoliaHit {
  objectID: string;
  title: string;
  url?: string;
  points: number;
  num_comments: number;
  author: string;
  created_at: string;
  _tags: string[];
}

interface HNAlgoliaResponse {
  hits: HNAlgoliaHit[];
}

const AI_KEYWORDS = ['AI', 'LLM', 'machine learning', 'neural', 'GPT', 'Claude', 'Gemini', 'OpenAI', 'Anthropic', 'transformer', 'diffusion', 'deep learning'];

export async function fetchAINews(
  options: FetchOptions = {}
): Promise<ToolResult<Article[]>> {
  const limit = options.limit ?? 10;

  // Use HN Algolia search for AI-related stories (free API, no auth)
  const query = options.tags?.join(' ') ?? 'AI LLM machine learning';
  
  const res = await axios.get<HNAlgoliaResponse>(`${HN_SEARCH}/search`, {
    params: {
      query,
      tags: 'story',
      hitsPerPage: Math.min(limit * 2, 30),
      numericFilters: `points>=${options.minScore ?? 10}`,
    },
    timeout: 8000,
  });

  const articles: Article[] = res.data.hits
    .filter((hit) => hit.title && hit.points != null)
    .slice(0, limit)
    .map((hit) => ({
      id: `hn-ai-${hit.objectID}`,
      title: hit.title,
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: 'ai-news' as const,
      score: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      author: hit.author,
      publishedAt: hit.created_at,
      tags: detectAITags(hit.title),
    }));

  return {
    data: articles,
    meta: {
      source: 'HN Algolia Search API (AI focus)',
      fetchedAt: new Date().toISOString(),
      count: articles.length,
    },
  };
}

function detectAITags(title: string): string[] {
  const lower = title.toLowerCase();
  return AI_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));
}
