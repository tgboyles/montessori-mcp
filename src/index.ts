import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TCClient } from "./clients/tc-client.js";
import { FirebaseClient } from "./clients/firebase-client.js";
import { buildTCTools } from "./tools/tc-tools.js";
import { buildOnespotTools } from "./tools/onespot-tools.js";

const TC_EMAIL = process.env.TC_EMAIL ?? "";
const TC_PASSWORD = process.env.TC_PASSWORD ?? "";
const ONESPOT_EMAIL = process.env.ONESPOT_EMAIL || TC_EMAIL;
const ONESPOT_PASSWORD = process.env.ONESPOT_PASSWORD || TC_PASSWORD;

if (!TC_EMAIL || !TC_PASSWORD) {
  process.stderr.write("Error: TC_EMAIL and TC_PASSWORD environment variables are required.\n");
  process.exit(1);
}

const tc = new TCClient(TC_EMAIL, TC_PASSWORD);
const fb = new FirebaseClient();

// Authenticate both services eagerly. Failures are non-fatal individually.
tc.authenticate().then((user) => {
  process.stderr.write(`TC authenticated: ${user.first_name} ${user.last_name} (school ${user.school_id}, roles: ${user.roles.join(", ")})\n`);
}).catch((err: Error) => {
  process.stderr.write(`TC auth failed: ${err.message}\n`);
});

fb.signIn(ONESPOT_EMAIL, ONESPOT_PASSWORD).then(async () => {
  const appId = process.env.ONESPOT_APP_ID || await fb.getMyAppId();
  if (appId) {
    fb.setAppId(appId);
    process.stderr.write(`Onespot/Firebase authenticated. App ID: ${appId}\n`);
  } else {
    process.stderr.write(`Onespot/Firebase authenticated. Call onespot_auto_setup to detect app ID.\n`);
  }
}).catch((err: Error) => {
  process.stderr.write(`Onespot/Firebase auth failed (tc_ tools still available): ${err.message}\n`);
});

const server = new McpServer({
  name: "montessori-mcp",
  version: "0.1.0",
});

// Register TC tools
for (const tool of buildTCTools(tc)) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {},
    tool.handler,
  );
}

// Register Onespot tools
for (const tool of buildOnespotTools(fb)) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {},
    tool.handler,
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("Montessori MCP server running on stdio.\n");
