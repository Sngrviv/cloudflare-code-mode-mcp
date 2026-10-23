// src/code-mode/schemaToTypeScript.ts
// Converts MCP tool JSON schemas into TypeScript type declarations.
// This is the KEY step in Code Mode — the LLM receives these stubs (~1000 tokens)
// instead of the raw tool list, dramatically shrinking context usage.

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
}

export interface SchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

/**
 * Converts a JSON Schema property into a TypeScript type string.
 */
function schemaPropertyToTSType(prop: SchemaProperty, indent = '  '): string {
  if (prop.enum) {
    return prop.enum.map((v) => `'${v}'`).join(' | ');
  }

  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      if (prop.items) {
        return `${schemaPropertyToTSType(prop.items)}[]`;
      }
      return 'unknown[]';
    case 'object':
      if (prop.properties) {
        const fields = Object.entries(prop.properties)
          .map(([k, v]) => `${indent}  ${k}: ${schemaPropertyToTSType(v, indent + '  ')}`)
          .join(';\n');
        return `{\n${fields}\n${indent}}`;
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

/**
 * Generates a TypeScript function signature for one MCP tool.
 * Example output:
 *   /** Fetch top stories from Hacker News ... *\/
 *   fetch_hacker_news(args: { limit?: number; minScore?: number; tags?: string[] }): Promise<string>
 */
function toolToTSSignature(tool: ToolSchema): string {
  const props = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);

  const params = Object.entries(props)
    .map(([name, prop]) => {
      const optional = !required.has(name) ? '?' : '';
      const tsType = schemaPropertyToTSType(prop);
      const defaultNote = prop.default !== undefined ? ` // default: ${JSON.stringify(prop.default)}` : '';
      const descNote = prop.description ? ` // ${prop.description}` : '';
      return `    ${name}${optional}: ${tsType};${defaultNote || descNote}`;
    })
    .join('\n');

  const argsType = Object.keys(props).length > 0 ? `{\n${params}\n  }` : 'Record<string, never>';

  // Wrap description to ~80 chars
  const descLines = tool.description
    .match(/.{1,80}(\s|$)/g)
    ?.map((l) => `   * ${l.trim()}`)
    .join('\n') ?? `   * ${tool.description}`;

  return `  /**\n${descLines}\n   */\n  ${tool.name}(args: ${argsType}): Promise<string>;`;
}

/**
 * Main export: converts a list of MCP tool schemas → a TypeScript interface declaration.
 *
 * This is what gets injected into the LLM prompt in Code Mode.
 * The LLM writes code against this interface — never sees raw JSON schemas.
 */
export function schemasToTypeScript(tools: ToolSchema[]): string {
  const signatures = tools.map(toolToTSSignature).join('\n\n');

  return `/**
 * TechNewsAPI — auto-generated from MCP tool schemas
 * Use this API object in your async function. Every method returns a JSON string.
 * Parse with JSON.parse() to work with the structured data.
 */
interface TechNewsAPI {
${signatures}
}

// The \`api\` variable is available in scope — it implements TechNewsAPI.
// Write an async function body and return your final result.
// Example:
//   const result = await api.fetch_hacker_news({ limit: 5 });
//   const data = JSON.parse(result);
//   return data.data.map(a => a.title);
declare const api: TechNewsAPI;
`;
}
