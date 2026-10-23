// src/mcp/server.ts
// MCP Server entry point — registers all 7 tools with the MCP SDK

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { fetchHackerNews } from './tools/fetchHackerNews.js';
import { fetchDevTo } from './tools/fetchDevTo.js';
import { fetchAINews } from './tools/fetchAINews.js';
import { searchNews, updateCache } from './tools/searchNews.js';
import { getTopTrending } from './tools/getTopTrending.js';
import { addBookmark, listBookmarks, clearBookmarks } from './tools/bookmark.js';
import type { Article } from './types.js';

export const server = new McpServer({
  name: 'tech-news-agent',
  version: '1.0.0',
});

// ─── Helper: refresh shared caches after any fetch ───────────────────────────
async function refreshCaches(): Promise<void> {
  // Silently pre-populate caches in the background for search & trending
  try {
    const [hn, ai, dev] = await Promise.all([
      fetchHackerNews({ limit: 20 }),
      fetchAINews({ limit: 20 }),
      fetchDevTo({ limit: 20 }),
    ]);
    const all: Article[] = [...hn.data, ...ai.data, ...dev.data];
    updateCache(all);
  } catch {
    // Cache refresh is best-effort
  }
}

// ─── Tool: fetch_hacker_news ──────────────────────────────────────────────────
server.tool(
  'fetch_hacker_news',
  'Fetch top stories from Hacker News. Returns articles with title, URL, score, comment count and author.',
  {
    limit: z.number().int().min(1).max(30).default(10)
      .describe('Number of articles to return (max 30)'),
    minScore: z.number().int().min(0).default(0)
      .describe('Minimum HN score (upvotes) to include'),
    tags: z.array(z.string()).optional()
      .describe('Filter articles whose title contains any of these keywords'),
  },
  async ({ limit, minScore, tags }) => {
    const result = await fetchHackerNews({ limit, minScore, tags });
    updateCache(result.data);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ─── Tool: fetch_ai_news ──────────────────────────────────────────────────────
server.tool(
  'fetch_ai_news',
  'Fetch AI and machine learning news from Hacker News Algolia search. Focused on LLMs, models, research papers.',
  {
    limit: z.number().int().min(1).max(30).default(10)
      .describe('Number of AI news articles to return'),
    minScore: z.number().int().min(0).default(10)
      .describe('Minimum score threshold'),
    tags: z.array(z.string()).optional()
      .describe('Specific AI topics to focus on (e.g. ["LLM", "GPT", "diffusion"])'),
  },
  async ({ limit, minScore, tags }) => {
    const result = await fetchAINews({ limit, minScore, tags });
    updateCache(result.data);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: fetch_devto ───────────────────────────────────────────────────────
server.tool(
  'fetch_devto',
  'Fetch latest tech articles from Dev.to community. Good for tutorials, open source, and developer tools.',
  {
    limit: z.number().int().min(1).max(30).default(10)
      .describe('Number of articles to return'),
    minScore: z.number().int().min(0).default(0)
      .describe('Minimum reaction count'),
    tags: z.array(z.string()).optional()
      .describe('Filter by Dev.to tags (e.g. ["typescript", "webdev", "ai"])'),
  },
  async ({ limit, minScore, tags }) => {
    const result = await fetchDevTo({ limit, minScore, tags });
    updateCache(result.data);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: search_news ───────────────────────────────────────────────────────
server.tool(
  'search_news',
  'Full-text search across all previously fetched articles (cached in memory). Must call fetch tools first to populate the cache.',
  {
    query: z.string().min(1).describe('Search query string'),
    limit: z.number().int().min(1).max(30).default(10)
      .describe('Maximum number of results'),
    sources: z.array(z.enum(['hackernews', 'devto', 'ai-news', 'rss'])).optional()
      .describe('Limit search to specific sources'),
  },
  async ({ query, limit, sources }) => {
    const result = await searchNews({ query, limit, sources });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_top_trending ───────────────────────────────────────────────────
server.tool(
  'get_top_trending',
  'Get top trending articles across all sources ranked by a composite score (upvotes + comments) with time decay.',
  {
    limit: z.number().int().min(1).max(20).default(10)
      .describe('Number of trending articles to return'),
    windowHours: z.number().int().min(1).max(168).default(24)
      .describe('Time window in hours to consider (default 24h, max 168h = 1 week)'),
  },
  async ({ limit, windowHours }) => {
    // Auto-refresh caches if empty
    await refreshCaches();
    const result = await getTopTrending({ limit, windowHours });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: bookmark_article ───────────────────────────────────────────────────
server.tool(
  'bookmark_article',
  'Save an article to your personal bookmark list (persisted to disk as JSON).',
  {
    article: z.object({
      id: z.string(),
      title: z.string(),
      url: z.string().url(),
      source: z.enum(['hackernews', 'devto', 'ai-news', 'rss']),
      score: z.number(),
      comments: z.number(),
      author: z.string(),
      publishedAt: z.string(),
      tags: z.array(z.string()),
      summary: z.string().optional(),
    }).describe('The article object to bookmark'),
  },
  async ({ article }) => {
    const result = await addBookmark(article as Article);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: list_bookmarks ─────────────────────────────────────────────────────
server.tool(
  'list_bookmarks',
  'List all saved bookmarks, most recent first.',
  {
    limit: z.number().int().min(1).max(50).default(20)
      .describe('Maximum number of bookmarks to return'),
  },
  async ({ limit }) => {
    const result = await listBookmarks({ limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Start server on stdio transport ─────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TechNewsAgent MCP server started on stdio');
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});
