// src/mcp/articleStore.ts
// Deep module: Centralized in-memory article store for deduplication, search, and trending rankings.
// Solves divergent state between searchNews and getTopTrending.

import type { Article, SearchOptions, TrendingOptions } from './types.js';

class ArticleStore {
  private articles: Map<string, Article> = new Map();
  private maxItems = 500;

  /**
   * Ingest fresh articles, automatically deduplicating by ID.
   */
  public addArticles(newArticles: Article[]): void {
    for (const article of newArticles) {
      if (!article.id) continue;
      this.articles.set(article.id, article);
    }

    // Maintain bounded size (keep newest)
    if (this.articles.size > this.maxItems) {
      const sorted = Array.from(this.articles.values()).sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
      this.articles = new Map(sorted.slice(0, this.maxItems).map((a) => [a.id, a]));
    }
  }

  /**
   * Return all cached articles.
   */
  public getAll(): Article[] {
    return Array.from(this.articles.values());
  }

  public size(): number {
    return this.articles.size;
  }

  /**
   * Clear the store (useful for tests and resets).
   */
  public clear(): void {
    this.articles.clear();
  }

  /**
   * Relevance-scored full-text search across cached articles.
   */
  public search(options: SearchOptions): Article[] {
    const query = options.query.toLowerCase();
    const limit = options.limit ?? 10;
    const tokens = query.split(/\s+/).filter(Boolean);

    return Array.from(this.articles.values())
      .filter((a) => {
        if (options.sources?.length && !options.sources.includes(a.source)) {
          return false;
        }
        return true;
      })
      .map((a) => {
        let relevance = 0;
        const searchable = [a.title, a.summary ?? '', ...a.tags, a.author]
          .join(' ')
          .toLowerCase();

        for (const token of tokens) {
          if (searchable.includes(token)) {
            relevance += a.title.toLowerCase().includes(token) ? 3 : 1;
          }
        }
        return { article: a, relevance };
      })
      .filter(({ relevance }) => relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ article }) => article);
  }

  /**
   * Rank articles by Hacker News-style logarithmic age-decay formula:
   * score = (article.score + article.comments * 0.5) / log10(hoursOld + 2)
   */
  public getTrending(options: TrendingOptions = {}): Array<Article & { trendingScore: number }> {
    const limit = options.limit ?? 10;
    const windowHours = options.windowHours ?? 24;
    const nowMs = Date.now();
    const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;

    return Array.from(this.articles.values())
      .filter((a) => {
        const time = new Date(a.publishedAt).getTime();
        return !isNaN(time) && time >= cutoffMs;
      })
      .map((a) => {
        const publishedMs = new Date(a.publishedAt).getTime();
        const hoursOld = (nowMs - publishedMs) / (1000 * 60 * 60);
        const agePenalty = Math.log10(Math.max(hoursOld, 0) + 2);
        const trendingScore = (a.score + a.comments * 0.5) / agePenalty;
        return { ...a, trendingScore };
      })
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit);
  }
}

// Singleton export
export const articleStore = new ArticleStore();
