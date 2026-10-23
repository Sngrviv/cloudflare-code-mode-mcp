// src/demo/directMode.ts
// DEMO: Traditional MCP tool calling — Direct Mode
//
// The LLM orchestrates step-by-step tool calls.
// Each tool result goes back through the context window.
// We track cumulative token usage to show the cost.

import { generate, countTokens } from '../llm/openRouterClient.js';
import { fetchHackerNews } from '../mcp/tools/fetchHackerNews.js';
import { fetchAINews } from '../mcp/tools/fetchAINews.js';
import { fetchDevTo } from '../mcp/tools/fetchDevTo.js';
import { updateCache } from '../mcp/tools/searchNews.js';
import { getTopTrending } from '../mcp/tools/getTopTrending.js';
import type { Article } from '../mcp/types.js';

const QUERY = 'Give me the top 5 tech articles today — mix of HN, AI news, and Dev.to. Rank them by score and give me a one-line summary for each.';

interface StepLog {
  step: number;
  action: string;
  tokensUsed: number;
  cumulativeTokens: number;
  dataSize: number; // characters of data returned
}

async function runDirectMode(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('  🔄  DIRECT MODE — Traditional MCP Tool Calling');
  console.log('═'.repeat(70));
  console.log(`\nQuery: "${QUERY}"\n`);

  const steps: StepLog[] = [];
  let cumulativeTokens = 0;
  const startMs = Date.now();

  // ── STEP 0: System prompt + initial query ────────────────────────────────
  // In real MCP, the LLM receives the full tool list JSON schemas here
  const toolListJson = JSON.stringify([
    { name: 'fetch_hacker_news', description: 'Fetch top HN stories', parameters: { limit: 'number', minScore: 'number', tags: 'string[]' } },
    { name: 'fetch_ai_news', description: 'Fetch AI/ML news', parameters: { limit: 'number', minScore: 'number' } },
    { name: 'fetch_devto', description: 'Fetch Dev.to articles', parameters: { limit: 'number', tags: 'string[]' } },
    { name: 'search_news', description: 'Search cached articles', parameters: { query: 'string', limit: 'number' } },
    { name: 'get_top_trending', description: 'Get trending articles', parameters: { limit: 'number' } },
  ], null, 2);

  const systemTokens = await countTokens(`You are an assistant with access to these tools:\n${toolListJson}`);
  cumulativeTokens += systemTokens;

  console.log(`📋 Step 0: Send tool list to LLM`);
  console.log(`   Tool list JSON: ${toolListJson.length} chars → ~${systemTokens} tokens`);
  steps.push({ step: 0, action: 'Send tool schemas to LLM', tokensUsed: systemTokens, cumulativeTokens, dataSize: toolListJson.length });

  // ── STEP 1: LLM decides to call fetch_hacker_news ────────────────────────
  console.log(`\n📋 Step 1: Call fetch_hacker_news({ limit: 5 })`);
  const hnResult = await fetchHackerNews({ limit: 5 });
  updateCache(hnResult.data);
  const hnJson = JSON.stringify(hnResult, null, 2);
  const hnTokens = await countTokens(hnJson);
  cumulativeTokens += hnTokens;
  console.log(`   Result: ${hnResult.data.length} articles, ${hnJson.length} chars → ~${hnTokens} tokens`);
  steps.push({ step: 1, action: 'fetch_hacker_news result → context window', tokensUsed: hnTokens, cumulativeTokens, dataSize: hnJson.length });

  // ── STEP 2: LLM calls fetch_ai_news ──────────────────────────────────────
  console.log(`\n📋 Step 2: Call fetch_ai_news({ limit: 5 })`);
  const aiResult = await fetchAINews({ limit: 5 });
  updateCache(aiResult.data);
  const aiJson = JSON.stringify(aiResult, null, 2);
  const aiTokens = await countTokens(aiJson);
  cumulativeTokens += aiTokens;
  console.log(`   Result: ${aiResult.data.length} articles, ${aiJson.length} chars → ~${aiTokens} tokens`);
  steps.push({ step: 2, action: 'fetch_ai_news result → context window', tokensUsed: aiTokens, cumulativeTokens, dataSize: aiJson.length });

  // ── STEP 3: LLM calls fetch_devto ────────────────────────────────────────
  console.log(`\n📋 Step 3: Call fetch_devto({ limit: 5 })`);
  const devResult = await fetchDevTo({ limit: 5 });
  updateCache(devResult.data);
  const devJson = JSON.stringify(devResult, null, 2);
  const devTokens = await countTokens(devJson);
  cumulativeTokens += devTokens;
  console.log(`   Result: ${devResult.data.length} articles, ${devJson.length} chars → ~${devTokens} tokens`);
  steps.push({ step: 3, action: 'fetch_devto result → context window', tokensUsed: devTokens, cumulativeTokens, dataSize: devJson.length });

  // ── STEP 4: LLM processes all data and generates final answer ─────────────
  console.log(`\n📋 Step 4: LLM generates final ranked + summarized answer`);

  const finalPrompt = `
You have fetched these articles:
HN: ${hnJson}
AI: ${aiJson}  
Dev.to: ${devJson}

Now answer: "${QUERY}"
Format as a numbered list. Each item: title, source, score, one-line summary.
`;
  const finalResult = await generate(
    'You are a helpful tech news assistant.',
    finalPrompt
  );

  cumulativeTokens += finalResult.promptTokens + finalResult.outputTokens;
  steps.push({ step: 4, action: 'LLM final synthesis', tokensUsed: finalResult.totalTokens, cumulativeTokens, dataSize: finalResult.text.length });

  const totalMs = Date.now() - startMs;

  // ── Print final answer ────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('📰  FINAL ANSWER (Direct Mode):');
  console.log('─'.repeat(70));
  console.log(finalResult.text);

  // ── Print stats ───────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('📊  DIRECT MODE STATS:');
  console.log('─'.repeat(70));
  console.log(`  Total LLM round-trips: ${steps.length}`);
  console.log(`  Total tokens consumed: ${cumulativeTokens.toLocaleString()}`);
  console.log(`  Total elapsed time:    ${totalMs}ms`);
  console.log('\n  Step-by-step breakdown:');
  for (const s of steps) {
    const bar = '█'.repeat(Math.min(Math.ceil(s.tokensUsed / 100), 40));
    console.log(`  Step ${s.step}: ${s.action}`);
    console.log(`         +${s.tokensUsed.toLocaleString()} tokens  ${bar}  (cumulative: ${s.cumulativeTokens.toLocaleString()})`);
  }

  // Export stats for compare.ts
  console.log('\n__STATS__:' + JSON.stringify({
    mode: 'direct',
    totalTokens: cumulativeTokens,
    roundTrips: steps.length,
    elapsedMs: totalMs,
  }));
}

runDirectMode().catch((err) => {
  console.error('Direct Mode demo failed:', err);
  process.exit(1);
});
