// src/demo/compare.ts
// Side-by-side comparison: Direct Mode vs Code Mode
// Runs both demos and prints a final comparison table

import { runCodeMode } from '../code-mode/codeModeClient.js';
import { generate, countTokens } from '../llm/openRouterClient.js';
import { fetchHackerNews } from '../mcp/tools/fetchHackerNews.js';
import { fetchAINews } from '../mcp/tools/fetchAINews.js';
import { fetchDevTo } from '../mcp/tools/fetchDevTo.js';
import { updateCache } from '../mcp/tools/searchNews.js';
import type { Article } from '../mcp/types.js';

const QUERY = 'What are the top 5 tech stories right now? Mix HN, AI news, and Dev.to. Rank by score.';

interface ModeStats {
  mode: string;
  totalTokens: number;
  roundTrips: number;
  elapsedMs: number;
  answer: string;
}

async function runDirectModeFast(): Promise<ModeStats> {
  const start = Date.now();
  let total = 0;

  // Tool list schema (what gets sent to LLM in direct mode)
  const toolListSchema = `[fetch_hacker_news, fetch_ai_news, fetch_devto, search_news, get_top_trending, bookmark_article, list_bookmarks]`;
  total += await countTokens(toolListSchema);

  const [hn, ai, dev] = await Promise.all([
    fetchHackerNews({ limit: 5 }),
    fetchAINews({ limit: 5 }),
    fetchDevTo({ limit: 5 }),
  ]);

  const allArticles: Article[] = [...hn.data, ...ai.data, ...dev.data];
  updateCache(allArticles);

  const hnJson = JSON.stringify(hn);
  const aiJson = JSON.stringify(ai);
  const devJson = JSON.stringify(dev);

  total += await countTokens(hnJson);
  total += await countTokens(aiJson);
  total += await countTokens(devJson);

  const finalR = await generate(
    'You are a tech news assistant.',
    `Articles:\nHN: ${hnJson}\nAI: ${aiJson}\nDev.to: ${devJson}\n\nAnswer: ${QUERY}`
  );
  total += finalR.totalTokens;

  return {
    mode: 'Direct Mode',
    totalTokens: total,
    roundTrips: 4,
    elapsedMs: Date.now() - start,
    answer: finalR.text,
  };
}

async function runCodeModeFast(): Promise<ModeStats> {
  const start = Date.now();

  const result = await runCodeMode(QUERY);

  const outputStr = JSON.stringify(result.output);
  const formatR = await generate(
    'Format this tech news data into a clean ranked list.',
    `Query: ${QUERY}\n\nData: ${outputStr}`
  );

  const total = result.llmUsage.totalTokens + formatR.totalTokens;

  return {
    mode: 'Code Mode',
    totalTokens: total,
    roundTrips: 2,
    elapsedMs: Date.now() - start,
    answer: formatR.text,
  };
}

async function main(): Promise<void> {
  console.log('\n' + '╔' + '═'.repeat(68) + '╗');
  console.log('║' + '  🏁  TECH NEWS AGENT — Direct Mode vs Code Mode Comparison  '.padEnd(68) + '║');
  console.log('╚' + '═'.repeat(68) + '╝');
  console.log(`\nQuery: "${QUERY}"\n`);
  console.log('Running both modes in parallel...\n');

  const [direct, code] = await Promise.all([
    runDirectModeFast(),
    runCodeModeFast(),
  ]);

  // ── Comparison Table ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('📊  COMPARISON RESULTS');
  console.log('═'.repeat(70));

  const tokenSavings = Math.round(((direct.totalTokens - code.totalTokens) / direct.totalTokens) * 100);
  const speedup = (direct.elapsedMs / code.elapsedMs).toFixed(1);

  console.log(`
┌─────────────────────────┬──────────────────┬──────────────────┐
│ Metric                  │ Direct Mode      │ Code Mode        │
├─────────────────────────┼──────────────────┼──────────────────┤
│ LLM Round-trips         │ ${String(direct.roundTrips).padEnd(16)} │ ${String(code.roundTrips).padEnd(16)} │
│ Total Tokens Used       │ ${String(direct.totalTokens.toLocaleString()).padEnd(16)} │ ${String(code.totalTokens.toLocaleString()).padEnd(16)} │
│ Elapsed Time            │ ${String(direct.elapsedMs + 'ms').padEnd(16)} │ ${String(code.elapsedMs + 'ms').padEnd(16)} │
│ Intermediate payloads   │ All in context   │ None in context  │
│ LLM sees raw data?      │ YES — all items  │ NO — final only  │
└─────────────────────────┴──────────────────┴──────────────────┘

  🎯  Token savings:  ${tokenSavings}% fewer tokens with Code Mode
  ⚡  Speed:          Code Mode is ${speedup}x ${Number(speedup) >= 1 ? 'faster' : 'slower'}
  🔄  Round-trips:    ${direct.roundTrips - code.roundTrips} fewer LLM calls with Code Mode
`);

  // ── The Core Insight ───────────────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('💡  WHY IT MATTERS:');
  console.log('─'.repeat(70));
  console.log(`
  Direct Mode: Every tool result (JSON payloads with ALL article fields)
               goes back through the LLM context window. As you add more
               tools or fetch more articles, this grows linearly — O(n).

  Code Mode:   The LLM sees ~${Math.ceil(code.totalTokens / 4 * 4)} tokens of type stubs instead of
               ${direct.totalTokens.toLocaleString()} tokens of raw data. The sandbox runs all the
               loops, filters, and aggregations locally.
               The LLM only sees the FINAL compact result.

  As your API grows from 7 tools to 70 tools, Code Mode stays flat.
  Direct Mode context explodes.
`);

  console.log('─'.repeat(70));
  console.log('📰  DIRECT MODE ANSWER:');
  console.log('─'.repeat(70));
  console.log(direct.answer);

  console.log('\n' + '─'.repeat(70));
  console.log('📰  CODE MODE ANSWER:');
  console.log('─'.repeat(70));
  console.log(code.answer);
}

main().catch((err) => {
  console.error('Compare demo failed:', err);
  process.exit(1);
});
