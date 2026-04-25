/**
 * MCP server entry. stdio transport, three tools registered:
 *   - search_razorpay_docs
 *   - get_razorpay_doc
 *   - validate_razorpay_code
 *
 * Stdout is reserved for JSON-RPC; all logs go to stderr (CLAUDE.md §5).
 * Embedder + reranker load lazily on first call (CLAUDE.md §9.9).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { loadPipelineConfig, RetrievalPipeline, RouteNotFoundError } from "./retrieval/pipeline.js";
import {
  SEARCH_TOOL_NAME,
  SEARCH_TOOL_DESCRIPTION,
  runSearchTool,
} from "./tools/search.js";
import {
  GET_DOC_TOOL_NAME,
  GET_DOC_TOOL_DESCRIPTION,
  runGetDocTool,
} from "./tools/get-doc.js";
import {
  VALIDATE_TOOL_NAME,
  VALIDATE_TOOL_DESCRIPTION,
  runValidateTool,
} from "./tools/validate.js";
import { SqliteCitationResolver } from "./validator/cite.js";
import { ALL_RULES } from "./validator/rules/index.js";
import { ValidationRunner } from "./validator/runner.js";
import { log } from "./util/log.js";

const SERVER_NAME = "razorpay-docs";
const SERVER_VERSION = "0.1.0";

// JSON-Schema for tool inputs (kept hand-written rather than generated from
// zod — small, stable, and the agent reads these descriptions).
const SEARCH_INPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 3,
      maxLength: 256,
      description: "Free-text search query.",
    },
    language: {
      type: "string",
      enum: ["node", "python", "php", "java", "ruby", "go", "dotnet", "kotlin", "curl"],
      description: "Filter code blocks to one SDK language.",
    },
    product: {
      type: "string",
      enum: [
        "payments",
        "x",
        "payroll",
        "pos",
        "partners",
        "magic-checkout",
        "subscriptions",
      ],
      description: "Restrict to a Razorpay product line.",
    },
    topic: {
      type: "string",
      enum: ["api", "webhooks", "integration", "errors", "security", "testing"],
      description: "Bias toward a topic.",
    },
    k: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      default: 3,
      description: "Number of results to return.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const GET_DOC_INPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    route_or_url: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Route slug like 'api/orders/create', razorpay.com docs URL, or raw GitHub URL.",
    },
    language: {
      type: "string",
      enum: ["node", "python", "php", "java", "ruby", "go", "dotnet", "kotlin", "curl"],
    },
    format: {
      type: "string",
      enum: ["markdown", "structured"],
      default: "markdown",
    },
  },
  required: ["route_or_url"],
  additionalProperties: false,
} as const;

const VALIDATE_INPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    code: {
      type: "string",
      minLength: 1,
      maxLength: 50_000,
      description: "Source code snippet to scan. ≤ 50 KB.",
    },
    language: {
      type: "string",
      enum: ["node", "python", "php", "java", "ruby", "go", "dotnet", "kotlin", "curl"],
      description: "SDK language hint. Auto-detected if omitted.",
    },
    filename: {
      type: "string",
      maxLength: 512,
      description: "Filename hint (e.g., 'webhook.js'); the extension drives detection.",
    },
    concern: {
      type: "string",
      enum: [
        "webhook_signature",
        "amount_handling",
        "order_flow",
        "idempotency",
        "key_safety",
        "pci_compliance",
        "currency",
        "capture",
        "webhook_handler",
        "payment_methods",
        "all",
      ],
      description: "Restrict scan to one concern. Default: all.",
    },
  },
  required: ["code"],
  additionalProperties: false,
} as const;

function errorContent(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function jsonContent(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export interface ServerHandle {
  readonly server: Server;
  readonly pipeline: RetrievalPipeline;
  readonly runner: ValidationRunner;
  close(): void;
}

export function createServer(): ServerHandle {
  const config = loadPipelineConfig(process.cwd());
  const pipeline = new RetrievalPipeline(config);

  const resolver = new SqliteCitationResolver(pipeline.bm25Handle);
  const runner = new ValidationRunner(resolver);
  runner.registerAll(ALL_RULES);
  log.info("validator ready", { rules: runner.count() });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: [
        {
          name: SEARCH_TOOL_NAME,
          description: SEARCH_TOOL_DESCRIPTION,
          inputSchema: SEARCH_INPUT_JSON_SCHEMA,
        },
        {
          name: GET_DOC_TOOL_NAME,
          description: GET_DOC_TOOL_DESCRIPTION,
          inputSchema: GET_DOC_INPUT_JSON_SCHEMA,
        },
        {
          name: VALIDATE_TOOL_NAME,
          description: VALIDATE_TOOL_DESCRIPTION,
          inputSchema: VALIDATE_INPUT_JSON_SCHEMA,
        },
      ],
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case SEARCH_TOOL_NAME: {
          const output = await runSearchTool({ pipeline }, args ?? {});
          return jsonContent(output);
        }
        case GET_DOC_TOOL_NAME: {
          const output = runGetDocTool({ pipeline }, args ?? {});
          return jsonContent(output);
        }
        case VALIDATE_TOOL_NAME: {
          const output = runValidateTool({ runner }, args ?? {});
          return jsonContent(output);
        }
        default: {
          return errorContent(
            `unknown tool '${name}'. expected: ${SEARCH_TOOL_NAME} | ${GET_DOC_TOOL_NAME} | ${VALIDATE_TOOL_NAME}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof RouteNotFoundError) {
        return errorContent(`Route not found: '${err.route}'. Try search_razorpay_docs first.`);
      }
      const message = err instanceof Error ? err.message : String(err);
      log.warn("tool error", name, message);
      return errorContent(`tool '${name}' failed: ${message}`);
    }
  });

  return {
    server,
    pipeline,
    runner,
    close: () => {
      pipeline.close();
    },
  };
}

async function main(): Promise<void> {
  const handle = createServer();
  const transport = new StdioServerTransport();

  const shutdown = (signal: NodeJS.Signals): void => {
    log.info("received", signal, "— shutting down");
    handle.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log.info(`razorpay-docs MCP server v${SERVER_VERSION}`, {
    embedder: handle.pipeline.config.embedderSpec,
    reranker: handle.pipeline.config.rerankerSpec,
    indexDir: handle.pipeline.config.indexDir,
  });

  await handle.server.connect(transport);
}

// Only run if invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);
if (invokedDirectly) {
  void (async (): Promise<void> => {
    try {
      await main();
    } catch (err) {
      log.error(err instanceof Error ? err : String(err));
      process.exit(1);
    }
  })();
}
