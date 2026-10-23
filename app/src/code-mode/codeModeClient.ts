// src/code-mode/codeModeClient.ts
// The Code Mode orchestrator: the heart of this project.
//
// Flow:
//   1. Get tool schemas from MCP tools
//   2. Convert schemas → TypeScript type stubs (~1000 tokens)
//   3. Build system prompt with the stubs
//   4. Send user query → LLM writes a TypeScript function
//   5. Execute that function in vm sandbox (api proxy routes to real tools)
//   6. Return ONLY the final result (no intermediate payloads to LLM)

import { schemasToTypeScript, type ToolSchema } from './schemaToTypeScript.js';
import { executeSandboxed, type ApiCallFn } from './sandbox.js';
import { generate, type GenerateResult } from '../llm/openRouterClient.js';

// Import all real tool implementations for the api proxy
import { fetchHackerNews } from '../mcp/tools/fetchHackerNews.js';
import { fetchDevTo } from '../mcp/tools/fetchDevTo.js';
import { fetchAINews } from '../mcp/tools/fetchAINews.js';
import { searchNews, updateCache } from '../mcp/tools/searchNews.js';
import { getTopTrending, setTrendingCache } from '../mcp/tools/getTopTrending.js';
import { addBookmark, listBookmarks, clearBookmarks } from '../mcp/tools/bookmark.js';
import type { Article } from '../mcp/types.js';

export interface CodeModeResult {
  // The TypeScript code the LLM wrote
  generatedCode: string;
  // The final output from sandbox execution
  output: unknown;
  // LLM token usage stats
  llmUsage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  // How long the sandbox took
  sandboxExecutionMs: number;
  // The TypeScript stubs fed to the LLM (so you can see how compact they are)
  typeStubs: string;
  success: boolean;
  error?: string;
}

// ─── Static tool schemas (normally you'd introspect from a running MCP server) ─
// These match exactly what server.ts registers
const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'fetch_hacker_news',
    description: 'Fetch top stories from Hacker News. Returns articles with title, URL, score, comment count and author.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of articles (max 30)', default: 10 },
        minScore: { type: 'integer', description: 'Minimum HN score', default: 0 },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by keywords in title' },
      },
    },
  },
  {
    name: 'fetch_ai_news',
    description: 'Fetch AI and ML news. Focused on LLMs, models, and research.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of articles (max 30)', default: 10 },
        minScore: { type: 'integer', description: 'Minimum score', default: 10 },
        tags: { type: 'array', items: { type: 'string' }, description: 'AI topics e.g. ["LLM","GPT"]' },
      },
    },
  },
  {
    name: 'fetch_devto',
    description: 'Fetch latest tech articles from Dev.to community.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of articles (max 30)', default: 10 },
        minScore: { type: 'integer', description: 'Minimum reaction count', default: 0 },
        tags: { type: 'array', items: { type: 'string' }, description: 'Dev.to tags e.g. ["typescript","ai"]' },
      },
    },
  },
  {
    name: 'search_news',
    description: 'Full-text search across all cached articles. Call fetch tools first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'integer', description: 'Max results', default: 10 },
        sources: { type: 'array', items: { type: 'string', enum: ['hackernews', 'devto', 'ai-news', 'rss'] }, description: 'Limit to specific sources' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_top_trending',
    description: 'Get top trending articles ranked by composite score with time decay.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of trending articles', default: 10 },
        windowHours: { type: 'integer', description: 'Time window in hours', default: 24 },
      },
    },
  },
  {
    name: 'bookmark_article',
    description: 'Save an article to bookmark list (persisted to disk).',
    inputSchema: {
      type: 'object',
      properties: {
        article: { type: 'object', description: 'Article object to bookmark' },
      },
      required: ['article'],
    },
  },
  {
    name: 'list_bookmarks',
    description: 'List all saved bookmarks, most recent first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max bookmarks to return', default: 20 },
      },
    },
  },
];

// ─── Real tool router: maps tool name → actual function call ──────────────────
const callTool: ApiCallFn = async (toolName, args) => {
  let result: unknown;

  switch (toolName) {
    case 'fetch_hacker_news': {
      const r = await fetchHackerNews(args as Parameters<typeof fetchHackerNews>[0]);
      updateCache(r.data);
      result = r;
      break;
    }
    case 'fetch_ai_news': {
      const r = await fetchAINews(args as Parameters<typeof fetchAINews>[0]);
      updateCache(r.data);
      result = r;
      break;
    }
    case 'fetch_devto': {
      const r = await fetchDevTo(args as Parameters<typeof fetchDevTo>[0]);
      updateCache(r.data);
      result = r;
      break;
    }
    case 'search_news':
      result = await searchNews(args as unknown as Parameters<typeof searchNews>[0]);
      break;
    case 'get_top_trending':
      result = await getTopTrending(args as Parameters<typeof getTopTrending>[0]);
      break;
    case 'bookmark_article':
      result = await addBookmark(args['article'] as Article);
      break;
    case 'list_bookmarks':
      result = await listBookmarks(args as Parameters<typeof listBookmarks>[0]);
      break;
    case 'clear_bookmarks':
      result = await clearBookmarks();
      break;
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }

  return JSON.stringify(result);
};

// ─── Code Mode system prompt ──────────────────────────────────────────────────
function buildSystemPrompt(typeStubs: string): string {
  return `You are a code generator. Your task is to write a single executable async JavaScript code snippet that answers the user's question using the TechNewsAPI.

${typeStubs}

RULES:
1. Write ONLY valid JavaScript inside a \`\`\`javascript ... \`\`\` block.
2. Do NOT output special tokens or tool call tags like <|tool_call_start|>. Write real JS code.
3. Use \`await api.tool_name({...args})\` to call tools. Each returns a JSON string.
4. Parse results with \`JSON.parse(res).data\` to work with the articles array.
5. Always return the final result (e.g. return filteredArticles;).
6. Combine, filter, and sort results using native JavaScript.

Example:
\`\`\`javascript
const raw = await api.fetch_hacker_news({ limit: 5 });
const parsed = JSON.parse(raw);
return parsed.data.map(a => ({ title: a.title, url: a.url, score: a.score }));
\`\`\`

Output ONLY the code block inside \`\`\`javascript ... \`\`\`. Nothing else.`;
}

// ─── Main Code Mode runner ────────────────────────────────────────────────────
export async function runCodeMode(userQuery: string): Promise<CodeModeResult> {
  // Step 1: Generate TypeScript stubs from schemas
  const typeStubs = schemasToTypeScript(TOOL_SCHEMAS);

  // Step 2: Build system prompt
  const systemPrompt = buildSystemPrompt(typeStubs);

  // Step 3: Ask LLM to write code
  let llmResult: GenerateResult;
  try {
    llmResult = await generate(systemPrompt, userQuery);
  } catch (err) {
    return {
      generatedCode: '',
      output: null,
      llmUsage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      sandboxExecutionMs: 0,
      typeStubs,
      success: false,
      error: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 4: Extract code from markdown fences
  const code = extractCode(llmResult.text);

  // Step 5: Execute in sandbox
  const sandboxResult = await executeSandboxed(code, callTool);

  return {
    generatedCode: code,
    output: sandboxResult.output,
    llmUsage: {
      promptTokens: llmResult.promptTokens,
      outputTokens: llmResult.outputTokens,
      totalTokens: llmResult.totalTokens,
    },
    sandboxExecutionMs: sandboxResult.executionMs,
    typeStubs,
    success: sandboxResult.success,
    error: sandboxResult.error,
  };
}

function extractCode(llmText: string): string {
  if (!llmText || !llmText.trim()) return '';

  // Strip wrapping ```markdown ... ``` if present
  let clean = llmText.trim();
  if (clean.startsWith('```markdown')) {
    clean = clean.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '');
  }

  // Extract from ```javascript ... ``` or ``` ... ``` blocks
  const match = clean.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // If no closing fences or partial fences, strip starting fence
  clean = clean.replace(/^```(?:javascript|js|typescript|ts)?\s*/i, '').replace(/\s*```$/i, '');
  return clean.trim();
}
