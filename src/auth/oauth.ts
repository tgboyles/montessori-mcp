import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { TCClient } from "../clients/tc-client.js";
import { FirebaseClient } from "../clients/firebase-client.js";
import { encrypt, decrypt } from "./crypto.js";
import { signAccessToken } from "./jwt.js";
import { storeAuthCode, consumeAuthCode } from "./kv.js";
import type { TcSession, FbSession } from "./jwt.js";

function serverUrl(): string {
  return (process.env.SERVER_URL ?? "").replace(/\/$/, "");
}

// ── Discovery metadata ──────────────────────────────────────────────────────

export function protectedResourceMetadata(_req: Request, res: Response): void {
  const base = serverUrl();
  res.json({
    resource: base,
    authorization_servers: [base],
  });
}

export function authServerMetadata(_req: Request, res: Response): void {
  const base = serverUrl();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
  });
}

// ── Client metadata document validation ────────────────────────────────────

interface ClientMetadata {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

async function fetchClientMetadata(clientId: string): Promise<ClientMetadata> {
  // client_id must be an HTTPS URL per the spec
  if (!clientId.startsWith("https://")) {
    throw new Error("client_id must be an HTTPS URL");
  }
  let meta: ClientMetadata;
  try {
    const res = await fetch(clientId, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meta = await res.json() as ClientMetadata;
  } catch (e) {
    throw new Error(`Could not fetch client metadata from ${clientId}: ${e}`);
  }
  // client_id in the document must exactly match the URL
  if (meta.client_id !== clientId) {
    throw new Error("client_id in metadata document does not match the URL");
  }
  if (!Array.isArray(meta.redirect_uris) || meta.redirect_uris.length === 0) {
    throw new Error("client metadata missing redirect_uris");
  }
  return meta;
}

// ── GET /oauth/authorize ────────────────────────────────────────────────────

export async function getAuthorize(req: Request, res: Response): Promise<void> {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } = req.query as Record<string, string>;

  if (response_type !== "code") {
    res.status(400).send("unsupported_response_type");
    return;
  }
  if (code_challenge_method !== "S256") {
    res.status(400).send("invalid_request: only S256 PKCE is supported");
    return;
  }
  if (!code_challenge || !client_id || !redirect_uri) {
    res.status(400).send("invalid_request: missing required parameters");
    return;
  }

  let clientName = "the app";
  try {
    const meta = await fetchClientMetadata(client_id);
    if (!meta.redirect_uris.includes(redirect_uri)) {
      res.status(400).send("invalid_request: redirect_uri not allowed");
      return;
    }
    clientName = meta.client_name ?? clientName;
  } catch (e) {
    res.status(400).send(`invalid_client: ${e}`);
    return;
  }

  const params = new URLSearchParams({ client_id, redirect_uri, code_challenge, code_challenge_method, ...(state ? { state } : {}) });
  res.send(loginHtml(clientName, params.toString()));
}

function loginHtml(clientName: string, hiddenParams: string): string {
  const pairs = hiddenParams.split("&").map(p => {
    const [k, v] = p.split("=");
    return `<input type="hidden" name="${decodeURIComponent(k)}" value="${decodeURIComponent(v ?? "")}">`;
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connect to Montessori MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 20px}
h1{font-size:1.3rem}label{display:block;margin-top:16px;font-size:.9rem;color:#444}
input[type=email],input[type=password]{width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;font-size:1rem}
button{margin-top:24px;width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer}
button:hover{background:#1d4ed8}.error{color:#dc2626;margin-top:12px;font-size:.9rem}</style></head>
<body><h1>Connect to Transparent Classroom</h1>
<p>Sign in so <strong>${clientName}</strong> can access your Transparent Classroom data.</p>
<form method="POST" action="/oauth/authorize">
${pairs.join("\n")}
<label>Email<input type="email" name="tc_email" required autocomplete="email"></label>
<label>Password<input type="password" name="tc_password" required autocomplete="current-password"></label>
<button type="submit">Connect</button>
</form></body></html>`;
}

// ── POST /oauth/authorize ───────────────────────────────────────────────────

export async function postAuthorize(req: Request, res: Response): Promise<void> {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, tc_email, tc_password } = req.body as Record<string, string>;

  if (!client_id || !redirect_uri || !code_challenge || !tc_email || !tc_password) {
    res.status(400).send("invalid_request: missing required parameters");
    return;
  }

  // Validate client again (re-fetch to prevent tampering)
  try {
    const meta = await fetchClientMetadata(client_id);
    if (!meta.redirect_uris.includes(redirect_uri)) {
      res.status(400).send("invalid_request: redirect_uri not allowed");
      return;
    }
  } catch (e) {
    res.status(400).send(`invalid_client: ${e}`);
    return;
  }

  // Authenticate with Transparent Classroom
  let tcSession: TcSession;
  let fbSession: FbSession | undefined;
  try {
    const tc = new TCClient(tc_email, tc_password);
    const user = await tc.authenticate();
    tcSession = { apiToken: tc.getApiToken(), schoolId: user.school_id };
  } catch {
    // Re-render login with error
    const params = new URLSearchParams({ client_id, redirect_uri, code_challenge, code_challenge_method, ...(state ? { state } : {}) });
    res.status(401).send(loginHtml("the app", params.toString()).replace("</form>", '<p class="error">Incorrect email or password. Please try again.</p></form>'));
    return;
  }

  // Authenticate with Firebase (Onespot) — non-fatal if it fails
  try {
    const fb = new FirebaseClient();
    const refreshToken = await fb.signIn(tc_email, tc_password);
    const appId = await fb.getMyAppId();
    fbSession = { refreshToken, userId: fb.currentUserId ?? "", appId };
  } catch {
    // Onespot auth failed — TC tools will still work
  }

  // Issue auth code
  const code = randomBytes(32).toString("base64url");
  await storeAuthCode(code, {
    codeChallenge: code_challenge,
    clientId: client_id,
    redirectUri: redirect_uri,
    tcPayload: encrypt(JSON.stringify(tcSession)),
    ...(fbSession ? { fbPayload: encrypt(JSON.stringify(fbSession)) } : {}),
  });

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("iss", serverUrl());
  if (state) callbackUrl.searchParams.set("state", state);
  res.redirect(callbackUrl.toString());
}

// ── POST /oauth/token ───────────────────────────────────────────────────────

export async function postToken(req: Request, res: Response): Promise<void> {
  const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body as Record<string, string>;

  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const stored = await consumeAuthCode(code);
  if (!stored) {
    res.status(400).json({ error: "invalid_grant", error_description: "Code expired or already used" });
    return;
  }

  // Verify PKCE: SHA256(code_verifier) must equal stored code_challenge
  const computed = createHash("sha256").update(code_verifier).digest("base64url");
  if (computed !== stored.codeChallenge) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  // Verify client_id and redirect_uri match what was stored
  if (stored.clientId !== client_id || stored.redirectUri !== redirect_uri) {
    res.status(400).json({ error: "invalid_grant", error_description: "client_id or redirect_uri mismatch" });
    return;
  }

  const tcSession = JSON.parse(decrypt(stored.tcPayload)) as TcSession;

  const accessToken = await signAccessToken({
    sub: String(tcSession.apiToken.slice(0, 8)), // opaque user identifier
    tc: stored.tcPayload,
    ...(stored.fbPayload ? { fb: stored.fbPayload } : {}),
  });

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 30 * 24 * 3600,
  });
}
