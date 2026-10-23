// src/mcp/tools/bookmark.ts
// Stateful tool: save and retrieve bookmarked articles (persisted to a local JSON file)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Article, BookmarkStore, ToolResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', '..', 'data');
const BOOKMARK_FILE = join(DATA_DIR, 'bookmarks.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): BookmarkStore {
  ensureDataDir();
  if (!existsSync(BOOKMARK_FILE)) {
    return { articles: [], savedAt: new Date().toISOString() };
  }
  try {
    const raw = readFileSync(BOOKMARK_FILE, 'utf-8');
    if (!raw.trim()) {
      return { articles: [], savedAt: new Date().toISOString() };
    }
    return JSON.parse(raw) as BookmarkStore;
  } catch {
    return { articles: [], savedAt: new Date().toISOString() };
  }
}

function writeStore(store: BookmarkStore): void {
  ensureDataDir();
  writeFileSync(BOOKMARK_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function addBookmark(
  article: Article
): Promise<ToolResult<{ message: string; total: number }>> {
  const store = readStore();
  const exists = store.articles.some((a) => a.id === article.id);

  if (!exists) {
    store.articles.push(article);
    store.savedAt = new Date().toISOString();
    writeStore(store);
  }

  return {
    data: {
      message: exists ? 'Already bookmarked' : `Bookmarked: "${article.title}"`,
      total: store.articles.length,
    },
    meta: {
      source: 'Local file (data/bookmarks.json)',
      fetchedAt: new Date().toISOString(),
      count: 1,
    },
  };
}

export async function listBookmarks(options: {
  limit?: number;
} = {}): Promise<ToolResult<Article[]>> {
  const store = readStore();
  const limit = options.limit ?? 20;
  const articles = store.articles.slice(-limit).reverse(); // most recent first

  return {
    data: articles,
    meta: {
      source: 'Local file (data/bookmarks.json)',
      fetchedAt: new Date().toISOString(),
      count: articles.length,
    },
  };
}

export async function clearBookmarks(): Promise<ToolResult<{ message: string }>> {
  writeStore({ articles: [], savedAt: new Date().toISOString() });
  return {
    data: { message: 'All bookmarks cleared' },
    meta: {
      source: 'Local file (data/bookmarks.json)',
      fetchedAt: new Date().toISOString(),
      count: 0,
    },
  };
}
