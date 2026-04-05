import express from "express";
import cors from "cors";

const VIATOR_API_KEY = process.env.VIATOR_API_KEY || "";
const VIATOR_BASE_URL = process.env.VIATOR_BASE_URL || "https://api.viator.com/partner";
const PORT = parseInt(process.env.PORT || "3000");

const app = express();
app.use(cors());
app.use(express.json());

// Viator API helper
async function viatorRequest(endpoint: string, method = "GET", body?: object, language = "en") {
  const url = `${VIATOR_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "exp-api-key": VIATOR_API_KEY,
    "Accept": "application/json;version=2.0",
    "Accept-Language": language,
    "Content-Type": "application/json"
  };
  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Viator API error ${response.status}`);
  return response.json();
}

// Tools definition
const TOOLS = [
  {
    name: "search_products",
    description: "Search for tours and activities",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Search term" },
        currency: { type: "string", default: "USD" },
        count: { type: "number", default: 10 }
      },
      required: ["searchTerm"]
    }
  },
  {
    name: "get_product",
    description: "Get product details with images",
    inputSchema: {
      type: "object",
      properties: {
        productCode: { type: "string", description: "Product code" }
      },
      required: ["productCode"]
    }
  },
  {
    name: "get_availability",
    description: "Get availability with start times",
    inputSchema: {
      type: "object",
      properties: {
        productCode: { type: "string" }
      },
      required: ["productCode"]
    }
  },
  {
    name: "get_destinations",
    description: "Get list of destinations",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_reviews",
    description: "Get product reviews",
    inputSchema: {
      type: "object",
      properties: {
        productCode: { type: "string" },
        count: { type: "number", default: 10 }
      },
      required: ["productCode"]
    }
  }
];

// Tool handlers
async function handleTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_products": {
      const body = {
        searchTerm: args.searchTerm,
        currency: args.currency || "USD",
        pagination: { start: 1, count: Math.min(Number(args.count) || 10, 50) }
      };
      return await viatorRequest("/search/freetext", "POST", body);
    }
    case "get_product":
      return await viatorRequest(`/products/${args.productCode}`, "GET");
    case "get_availability":
      return await viatorRequest(`/availability/schedules/${args.productCode}`, "GET");
    case "get_destinations":
      return await viatorRequest("/destinations", "GET");
    case "get_reviews": {
      const body = {
        productCode: args.productCode,
        pagination: { offset: 0, limit: Number(args.count) || 10 }
      };
      return await viatorRequest("/reviews/product", "POST", body);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok", hasApiKey: !!VIATOR_API_KEY });
});

// MCP SSE endpoint
app.get("/mcp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send server info
  const serverInfo = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: { serverInfo: { name: "viator-mcp-server", version: "1.0.0" } }
  };
  res.write(`data: ${JSON.stringify(serverInfo)}\n\n`);

  req.on("close", () => res.end());
});

// MCP POST handler
app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  try {
    let result;
    
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "viator-mcp-server", version: "1.0.0" },
          capabilities: { tools: {} }
        };
        break;
      
      case "tools/list":
        result = { tools: TOOLS };
        break;
      
      case "tools/call":
        const toolResult = await handleTool(params.name, params.arguments || {});
        result = {
          content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }]
        };
        break;
      
      default:
        result = {};
    }

    res.json({ jsonrpc: "2.0", id, result });
  } catch (error) {
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: String(error) }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Viator MCP Server on port ${PORT}`);
});
