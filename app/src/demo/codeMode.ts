// src/demo/codeMode.ts
// DEMO: Code Mode — LLM writes TypeScript, sandbox executes it
//
// The LLM receives ~1000 tokens of type stubs, writes ONE function,
// sandbox executes it making multiple tool calls internally,
// ONLY the final result returns to the LLM context.

import { runCodeMode } from '../code-mode/codeModeClient.js';
import { generate } from '../llm/openRouterClient.js';

const QUERY = 'Give me the top 5 tech articles today — mix of HN, AI news, and Dev.to. Rank them by score and give me a one-line summary for each.';

async function runCodeModeDemo(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('  ⚡  CODE MODE — LLM writes TypeScript, Sandbox executes');
  console.log('═'.repeat(70));
  console.log(`\nQuery: "${QUERY}"\n`);

  const startMs = Date.now();

  // ── STEP 1: Run Code Mode ─────────────────────────────────────────────────
  console.log('📋 Step 1: Generate TypeScript type stubs from MCP schemas');
  const result = await runCodeMode(QUERY);

  // ── Print generated code ──────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('💻  GENERATED CODE (what the LLM wrote):');
  console.log('─'.repeat(70));
  console.log(result.generatedCode);

  // ── Print type stubs fed to LLM ───────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('📝  TYPE STUBS fed to LLM (instead of raw tool list):');
  console.log('─'.repeat(70));
  console.log(result.typeStubs);

  if (!result.success) {
    console.error('\n❌ Sandbox execution failed:', result.error);
    process.exit(1);
  }

  // ── STEP 2: LLM formats the sandbox output into a readable answer ─────────
  console.log('─'.repeat(70));
  console.log('📋 Step 2: LLM formats the sandbox output into final answer');
  console.log('   (Only the compact final result goes to LLM — NOT all raw articles)\n');

  const outputStr = JSON.stringify(result.output, null, 2);
  const formattingResult = await generate(
    'You are a helpful tech news assistant. Format the provided data into a clean, readable answer.',
    `The user asked: "${QUERY}"\n\nThe data pipeline returned:\n${outputStr}\n\nFormat this as a numbered list with source, score, and one-line summary for each.`
  );

  const totalMs = Date.now() - startMs;

  // ── Print final answer ────────────────────────────────────────────────────
  console.log('📰  FINAL ANSWER (Code Mode):');
  console.log('─'.repeat(70));
  console.log(formattingResult.text);

  // ── Print stats ───────────────────────────────────────────────────────────
  const codeGenTokens = result.llmUsage.totalTokens;
  const formatTokens = formattingResult.totalTokens;
  const totalTokens = codeGenTokens + formatTokens;

  console.log('\n' + '─'.repeat(70));
  console.log('📊  CODE MODE STATS:');
  console.log('─'.repeat(70));
  console.log(`  Total LLM round-trips: 2  (generate code + format result)`);
  console.log(`  Total tokens consumed: ${totalTokens.toLocaleString()}`);
  console.log(`    ├─ Code generation:  ${codeGenTokens.toLocaleString()} tokens`);
  console.log(`       ├─ Prompt (stubs): ${result.llmUsage.promptTokens.toLocaleString()} tokens  ← type stubs are tiny!`);
  console.log(`       └─ Output (code):  ${result.llmUsage.outputTokens.toLocaleString()} tokens`);
  console.log(`    └─ Result formatting: ${formatTokens.toLocaleString()} tokens`);
  console.log(`  Sandbox execution:     ${result.sandboxExecutionMs}ms`);
  console.log(`  Total elapsed time:    ${totalMs}ms`);
  console.log(`\n  Type stubs size:   ${result.typeStubs.length} chars (~${Math.ceil(result.typeStubs.length / 4)} tokens)`);
  console.log(`  Tool calls made by sandbox (invisible to LLM context): multiple`);

  // Export stats for compare.ts
  console.log('\n__STATS__:' + JSON.stringify({
    mode: 'code-mode',
    totalTokens,
    roundTrips: 2,
    elapsedMs: totalMs,
  }));
}

runCodeModeDemo().catch((err) => {
  console.error('Code Mode demo failed:', err);
  process.exit(1);
});
