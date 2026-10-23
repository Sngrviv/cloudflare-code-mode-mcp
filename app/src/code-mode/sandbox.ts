// src/code-mode/sandbox.ts
// Secure sandboxed execution of LLM-generated TypeScript/JavaScript code.
// Uses Node.js built-in `vm` module — no extra dependencies.
//
// How it works:
//   1. Receive LLM-generated async function body (JavaScript)
//   2. Wrap it in an async IIFE
//   3. Inject the `api` proxy that maps api.tool_name() → actual MCP tool call
//   4. Execute with a timeout
//   5. Return only the final return value

import vm from 'vm';

export type ApiCallFn = (toolName: string, args: Record<string, unknown>) => Promise<string>;

export interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionMs: number;
}

/**
 * Creates a Proxy object that the sandboxed code calls as `api`.
 * Each property access returns an async function that calls the real MCP tool.
 */
function createApiProxy(callTool: ApiCallFn): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, toolName: string) {
      return async (args: Record<string, unknown> = {}) => {
        return await callTool(toolName, args);
      };
    },
  });
}

/**
 * Executes LLM-generated code in a sandboxed vm context.
 *
 * @param code     - JavaScript/TypeScript code (function body or full async function)
 * @param callTool - Function that routes api.X() calls to real tools
 * @param timeoutMs - Max execution time (default 30 seconds)
 */
export async function executeSandboxed(
  code: string,
  callTool: ApiCallFn,
  timeoutMs = 30_000
): Promise<SandboxResult> {
  const startMs = Date.now();

  // Strip TypeScript-specific syntax (the vm module runs JS only)
  const jsCode = stripTypeScript(code);

  // Extract just the function body if the LLM returned a full async function
  const body = extractFunctionBody(jsCode);

  // Wrap in an async IIFE for execution
  const wrappedCode = `(async () => { ${body} })()`;

  const api = createApiProxy(callTool);

  // Sandbox context: only expose api + safe globals
  const context = vm.createContext({
    api,
    JSON,
    Math,
    Date,
    console: {
      log: (...args: unknown[]) => process.stdout.write(`[sandbox] ${args.join(' ')}\n`),
      error: (...args: unknown[]) => process.stderr.write(`[sandbox] ${args.join(' ')}\n`),
    },
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  });

  try {
    const script = new vm.Script(wrappedCode, { filename: 'llm-generated.js' });
    const output = await script.runInContext(context, { timeout: timeoutMs });
    return {
      success: true,
      output,
      executionMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      executionMs: Date.now() - startMs,
    };
  }
}

/**
 * Strips basic TypeScript syntax so the vm module can run it as plain JS.
 * (In production you'd use a proper transpiler like esbuild/sucrase)
 */
function stripTypeScript(code: string): string {
  return code
    // Strip special tokens like <|tool_call_start|>, <|tool_call_end|>, etc.
    .replace(/<\|.*?\|>/g, '')
    // Remove type annotations: variable: Type
    .replace(/:\s*(string|number|boolean|void|any|unknown|never|null|undefined)(\[\])?/g, '')
    // Remove generic type params in function calls: fn<Type>(...)
    .replace(/<[A-Z][A-Za-z]*>/g, '')
    // Remove interface/type declarations
    .replace(/^(interface|type)\s+\w+[^;{]*(\{[^}]*\}|;)/gm, '')
    // Remove const/let type assertions: as Type
    .replace(/\s+as\s+[A-Za-z<>\[\]|&]+/g, '')
    // Remove return type annotations on functions: ): Type =>
    .replace(/\)\s*:\s*[A-Za-z<>\[\]|&]+\s*(?=\{|=>)/g, ')');
}

/**
 * If the LLM wrapped code in an async function declaration, extract just the body.
 */
function extractFunctionBody(code: string): string {
  let trimmed = code.trim();

  // If code is just an array of calls: [api.fetch_x(), api.fetch_y()]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return `return await Promise.all(${trimmed});`;
  }

  // If code is just a bare api call without return: api.fetch_hacker_news(...)
  if (trimmed.startsWith('api.') || trimmed.startsWith('await api.')) {
    if (!trimmed.startsWith('return ') && !trimmed.includes('const ') && !trimmed.includes('let ')) {
      return `return await ${trimmed.replace(/^await\s+/, '')};`;
    }
  }

  // Match: async function name(...) { BODY } or async (...) => { BODY }
  const fnBodyMatch = trimmed.match(/async\s+(?:function\s+\w+\s*)?\([^)]*\)\s*(?::\s*\S+\s*)?\{([\s\S]*)\}\s*$/);
  if (fnBodyMatch) {
    return fnBodyMatch[1].trim();
  }
  // Match: async () => EXPR (no braces, arrow function expression)
  const arrowExprMatch = trimmed.match(/async\s*(?:\([^)]*\)|\w+)\s*=>\s*([\s\S]+)$/);
  if (arrowExprMatch) {
    return `return ${arrowExprMatch[1].trim()}`;
  }
  // Code is already a function body — return as-is
  return trimmed;
}
