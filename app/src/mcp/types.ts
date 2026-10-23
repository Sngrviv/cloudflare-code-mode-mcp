// src/mcp/types.ts
// Shared domain types used across all tools and the Code Mode engine

export interface Article {
  id: string;
  title: string;
  url: string;
  source: NewsSource;
  score: number;        // upvotes / likes / engagement score
  comments: number;
  author: string;
  publishedAt: string;  // ISO 8601
  tags: string[];
  summary?: string;     // populated by summarizeArticle tool
}

export type NewsSource = 'hackernews' | 'devto' | 'ai-news' | 'rss';

export interface FetchOptions {
  limit?: number;       // default 10
  tags?: string[];      // filter by tag
  minScore?: number;    // minimum score threshold
}

export interface SearchOptions {
  query: string;
  limit?: number;
  sources?: NewsSource[];
}

export interface TrendingOptions {
  limit?: number;
  windowHours?: number; // how many hours back to look, default 24
}

export interface BookmarkStore {
  articles: Article[];
  savedAt: string;
}

export interface ToolResult<T> {
  data: T;
  meta: {
    source: string;
    fetchedAt: string;
    count: number;
  };
}
