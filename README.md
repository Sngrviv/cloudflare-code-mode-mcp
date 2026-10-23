# ⚡ TechNewsAgent — Cloudflare Code Mode vs. Traditional MCP

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/Protocol-MCP-orange.svg)](https://modelcontextprotocol.io/)
[![Cloudflare Research](https://img.shields.io/badge/Architecture-Code%20Mode-F38020.svg)](https://blog.cloudflare.com/code-mode/)
[![OpenRouter](https://img.shields.io/badge/LLM-OpenRouter%20Free%20Tier-green.svg)](https://openrouter.ai/)

> *"I studied Cloudflare's research on **Code Mode** ([blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/)) and wanted to validate it hands-on. Instead of standard MCP tool calling where every intermediate result bloats the context window, Cloudflare's approach compiles MCP schemas into a typed TypeScript API so the LLM writes executable code that runs inside a local sandbox. I built this demonstration from scratch to compare both models empirically using 100% free APIs and free-tier LLMs."*

---

## 📖 Table of Contents
- [Executive Summary](#-executive-summary)
- [How Cloudflare Code Mode Works](#-how-cloudflare-code-mode-works)
- [Architecture & Sequence Flow](#-architecture--sequence-flow)
- [Empirical Comparison (Direct Mode vs. Code Mode)](#-empirical-comparison)
- [The 7 Free MCP Tools](#-the-7-free-mcp-tools)
- [Project Structure](#-project-structure)
- [Quick Start Guide](#-quick-start-guide)
- [Key Takeaways & Learnings](#-key-takeaways--learnings)

---

## 🚀 Executive Summary

When building LLM agents with traditional **Model Context Protocol (MCP)** tool calling, multi-step queries suffer from **context bloat** and **high latency**:
1. Every tool call returns raw data directly into the model's context window.
2. An agent fetching 30 news items forces thousands of unneeded tokens through attention layers.
3. Complex pipelines (combining, deduplicating, sorting, filtering) require multiple sequential LLM round-trips.

**Cloudflare's Code Mode** replaces tool calling with **code execution**:
- MCP tool JSON schemas are translated into a **TypeScript Interface** (`interface TechNewsAPI`).
- The LLM receives this compact type definition (~550 tokens vs. ~1,500+ tokens of JSON Schema).
- The LLM writes **ONE** concise JavaScript/TypeScript script.
- A local **Node.js VM Sandbox** runs the script, executes the tool calls concurrently in-memory, sorts/filters the data, and returns **only the final compact result** to the LLM.

---

## 🧠 How Cloudflare Code Mode Works

```
Traditional Direct Mode:
User Query ──> [LLM] ──> tool_call: fetch_hacker_news ──> [10 articles in context]
                     ──> tool_call: fetch_ai_news     ──> [20 articles in context]
                     ──> tool_call: fetch_devto       ──> [30 articles in context]
                     ──> LLM synthesizes final answer (bloated context: 5,000+ tokens)

Cloudflare Code Mode:
User Query ──> [LLM receives TypeScript stubs (~550 tokens)]
             ──> LLM writes ONE script:
                   const [hn, ai, dev] = await Promise.all([
                     api.fetch_hacker_news({ limit: 5 }),
                     api.fetch_ai_news({ limit: 5 }),
                     api.fetch_devto({ limit: 5 })
                   ]);
                   return [...JSON.parse(hn).data, ...JSON.parse(ai).data, ...JSON.parse(dev).data]
                     .sort((a, b) => b.score - a.score).slice(0, 5);
             ──> [Sandbox executes locally in 1-4s]
             ──> LLM sees ONLY the top 5 articles (zero intermediate token waste)
```

---

## 📊 Empirical Comparison

Results from running `npm run demo:compare` live against Hacker News, Dev.to, and AI News:

| Metric | Traditional Direct Mode | Cloudflare Code Mode | Impact |
|:---|:---:|:---:|:---:|
| **LLM Round-Trips** | **4 round-trips** | **2 round-trips** | **50% fewer round-trips** |
| **Intermediate Payloads in Context** | **4,924+ tokens** | **0 tokens** | **100% eliminated** |
| **Tool Execution** | Sequential serial calls | Concurrent `Promise.all()` | Lower execution latency |
| **Sorting / Ranking** | Probabilistic (LLM attention) | Deterministic JavaScript math | 100% exact math |
| **Scalability** | $O(n)$ context token explosion | $O(1)$ constant type stub size | Scales to 100+ tools |

---

## 🛠️ The 7 Free MCP Tools

All news APIs and utilities are **100% free and require no API keys**:

| Tool | Source | Auth Required | Purpose |
|---|---|:---:|---|
| `fetch_hacker_news` | Hacker News Firebase API | ❌ None | Top stories with scores, comments, author |
| `fetch_ai_news` | HN Algolia Search API | ❌ None | Targeted AI/ML/LLM articles |
| `fetch_devto` | Dev.to Public REST API | ❌ None | Community tutorials & software articles |
| `search_news` | In-memory ArticleStore | ❌ None | Full-text keyword search across cached articles |
| `get_top_trending` | In-memory ArticleStore | ❌ None | Hacker News logarithmic age-decay trending |
| `bookmark_article` | Local JSON Storage | ❌ None | Persist articles to local storage (`data/`) |
| `list_bookmarks` | Local JSON Storage | ❌ None | Retrieve saved bookmarks |

---

## 📂 Project Structure

All dependencies and code are self-contained inside `app/`:

```
MCP-Typescript/
├── README.md                      ← Project overview and study documentation
├── docs/
│   └── CLOUDFLARE_CODE_MODE_STUDY.md ← In-depth technical breakdown and analysis
└── app/                           ← Self-contained environment
    ├── .env.example               ← Template for API keys
    ├── package.json               ← Scripts and dependencies
    ├── tsconfig.json              ← Strict TypeScript configuration
    └── src/
        ├── mcp/
        │   ├── server.ts          ← Standalone MCP server (7 tools)
        │   ├── types.ts           ← Shared domain types (Article, ToolResult)
        │   ├── articleStore.ts    ← Deep module: Unified cache, search & ranking
        │   └── tools/             ← Tool implementations (HN, Dev.to, AI, bookmarks)
        ├── code-mode/
        │   ├── schemaToTypeScript.ts ← Converts MCP schemas → TypeScript interface
        │   ├── sandbox.ts            ← Node.js VM sandbox with api Proxy
        │   └── codeModeClient.ts     ← Orchestrator: Code generation & execution
        ├── llm/
        │   └── openRouterClient.ts   ← OpenRouter client with free tier models & fallback
        └── demo/
            ├── directMode.ts      ← Traditional MCP tool calling runner
            ├── codeMode.ts        ← Code Mode runner
            └── compare.ts         ← Side-by-side benchmark runner
```

---

## ⚡ Quick Start Guide

### 1. Prerequisites
- Node.js 18+ (tested on Node.js 24)
- Free OpenRouter API Key ([openrouter.ai/settings/keys](https://openrouter.ai/settings/keys))

### 2. Configuration
Navigate to the `app/` folder and create your `.env` file:
```powershell
cd app
Copy-Item .env.example .env
```
Edit `.env` and set your key:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 3. Run the Demos

```powershell
# Run the side-by-side comparison benchmark:
npm run demo:compare

# Run Code Mode demonstration only:
npm run demo:code-mode

# Run Traditional Direct Mode only:
npm run demo:direct

# Start the standalone MCP Server (for Claude Desktop / MCP Inspector):
npm run dev:server
```

---

## 💡 Key Takeaways & Learnings

1. **Context Window Hygiene**:
   In complex agent pipelines, sending all raw data to the LLM wastes tokens and degrades performance. Keeping intermediate data in a sandboxed runtime drastically cuts costs and improves response quality.
2. **TypeScript as an Agent Language**:
   Code generation models understand TypeScript types and function signatures far better than deeply nested JSON schemas.
3. **Deterministic Logic in Code, Synthesis in LLM**:
   Let the programming language handle sorting, filtering, and aggregation. Reserve the LLM for high-level synthesis and natural language presentation.
4. **Architectural Cohesion**:
   Unifying storage and search into a deep `ArticleStore` ensures reliable, deduplicated state across all tool calls whether run directly or via Code Mode.
