import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TCClient } from "./clients/tc-client.js";
import { FirebaseClient } from "./clients/firebase-client.js";
import { buildTCTools } from "./tools/tc-tools.js";
import { buildOnespotTools } from "./tools/onespot-tools.js";
import { decrypt } from "./auth/crypto.js";
import { authenticate } from "./auth/middleware.js";
import { exchangeRefreshToken } from "./auth/firebase-refresh.js";
import {
  protectedResourceMetadata,
  authServerMetadata,
  getAuthorize,
  postAuthorize,
  postToken,
} from "./auth/oauth.js";
import type { TcSession, FbSession } from "./auth/jwt.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const SERVER_URL = (process.env.SERVER_URL ?? "").replace(/\/$/, "");

// ── MCP Express app (handles host-header / DNS-rebinding validation) ────────

const allowedHosts = [new URL(SERVER_URL.startsWith("http") ? SERVER_URL : `http://${SERVER_URL}`).hostname, "localhost", "127.0.0.1"];
const mcpApp = createMcpExpressApp({ host: "0.0.0.0", allowedHosts });
mcpApp.use(express.urlencoded({ extended: false }));

// ── OAuth discovery & flow ──────────────────────────────────────────────────

mcpApp.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
mcpApp.get("/.well-known/oauth-authorization-server", authServerMetadata);
mcpApp.get("/oauth/authorize", (req, res) => { void getAuthorize(req, res); });
mcpApp.post("/oauth/authorize", (req, res) => { void postAuthorize(req, res); });
mcpApp.post("/oauth/token", (req, res) => { void postToken(req, res); });

// ── Health check ────────────────────────────────────────────────────────────

mcpApp.get("/health", (_req, res) => { res.json({ ok: true }); });

// ── MCP endpoint ────────────────────────────────────────────────────────────

mcpApp.post("/mcp", authenticate, async (req, res) => {
  const { tc: tcPayload, fb: fbPayload } = req.principal;

  const tcSession = JSON.parse(decrypt(tcPayload)) as TcSession;
  const tc = TCClient.fromToken(tcSession.apiToken, tcSession.schoolId);

  let fb = new FirebaseClient();
  if (fbPayload) {
    try {
      const fbSession = JSON.parse(decrypt(fbPayload)) as FbSession;
      const idToken = await exchangeRefreshToken(fbSession.refreshToken);
      fb = FirebaseClient.fromToken(idToken, fbSession.userId, fbSession.appId);
    } catch {
      // Onespot unavailable — TC tools still work
    }
  }

  const server = new McpServer({ name: "montessori-mcp", version: "0.1.0" });
  for (const tool of buildTCTools(tc)) {
    server.tool(tool.name, tool.description,
      tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {},
      tool.handler);
  }
  for (const tool of buildOnespotTools(fb)) {
    server.tool(tool.name, tool.description,
      tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {},
      tool.handler);
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
    void transport.close();
    void server.close();
    throw err;
  }
});

mcpApp.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});
mcpApp.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});

// ── Dev-mode: auto-login and print a test JWT ───────────────────────────────

async function devLogin(): Promise<void> {
  const email = process.env.TC_EMAIL;
  const password = process.env.TC_PASSWORD;
  if (!email || !password) return;

  const { encrypt } = await import("./auth/crypto.js");
  const { signAccessToken } = await import("./auth/jwt.js");

  try {
    const tc = new TCClient(email, password);
    const user = await tc.authenticate();
    const tcPayload = encrypt(JSON.stringify({ apiToken: tc.getApiToken(), schoolId: user.school_id }));

    let fbPayload: string | undefined;
    try {
      const fb = new FirebaseClient();
      const refreshToken = await fb.signIn(email, password);
      const appId = await fb.getMyAppId();
      fbPayload = encrypt(JSON.stringify({ refreshToken, userId: fb.currentUserId, appId }));
    } catch {
      // ignore
    }

    const token = await signAccessToken({ sub: user.id.toString(), tc: tcPayload, ...(fbPayload ? { fb: fbPayload } : {}) });
    process.stderr.write(`\n[dev] Test JWT for /mcp:\n  Authorization: Bearer ${token}\n\n`);
  } catch (err) {
    process.stderr.write(`[dev] Auto-login failed: ${err}\n`);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

export function startServer(): void {
  if (process.env.NODE_ENV === "development") {
    void devLogin();
  }

  mcpApp.listen(PORT, "0.0.0.0", () => {
    process.stderr.write(`Montessori MCP server listening on port ${PORT}\n`);
    process.stderr.write(`MCP endpoint: ${SERVER_URL}/mcp\n`);
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
