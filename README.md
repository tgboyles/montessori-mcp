# Montessori MCP

An MCP server that connects Claude to **Onespot** (The Montessori App, by Seabird Apps) and **Transparent Classroom**. Gives Claude access to school notifications, classroom feeds, posts, events, and TC account data — all scoped to the authenticated user's own data.

## Installation (hosted)

The easiest way is the hosted server on Render — no npm, no config files.

1. In Claude, go to **Settings → Integrations** (Claude.ai) or **Settings → Customize → Connectors** (Claude desktop)
2. Add this URL: `https://montessori-mcp.onrender.com/mcp`
3. Claude will open a browser window with a Transparent Classroom login form
4. Sign in once — all future sessions are silent

> **Note:** The free-tier Render instance spins down after inactivity. The first request after a cold start may take up to 60 seconds.

## Available Tools

### Onespot / The Montessori App

| Tool | Description |
|---|---|
| `onespot_get_my_profile` | Your Onespot profile and detected app ID. |
| `onespot_list_notifications` | School-wide push notifications — closures, building updates, admin announcements. |
| `onespot_list_portals` | All sections of the school app: feeds, chats, calendar, static pages. |
| `onespot_list_posts` | Recent posts in a specific activity feed. Requires a `feed_id` from `onespot_list_portals`. |
| `onespot_get_post` | A specific post with all comments and author names. |
| `onespot_post_message` | Post a new message to an activity feed. |
| `onespot_add_comment` | Comment on an existing post. |
| `onespot_list_events` | School calendar events. |
| `onespot_explore_path` | Explore any Firebase RTDB path directly. Useful for debugging. |

### Transparent Classroom

| Tool | Description | Role required |
|---|---|---|
| `tc_get_my_info` | Your TC profile: name, role, school ID. | Any |
| `tc_list_children` | All children at the school. | Staff / Admin |
| `tc_list_classrooms` | All classrooms. | Staff / Admin |
| `tc_list_lessons` | Lesson history for a child. | Staff / Admin |
| `tc_list_observations` | Teacher observations for a child. | Staff / Admin |
| `tc_list_events` | TC calendar events. | Staff / Admin |
| `tc_list_users` | Staff directory. | Staff / Admin |
| `tc_list_conference_reports` | Progress/conference reports for a child. | Staff / Admin |

> **Note for parent accounts:** TC's REST API does not grant parents access to school-wide data. Staff-only tools return `Forbidden`. All parent-facing school data is available through the `onespot_` tools instead.

## How it works

Authentication uses the MCP OAuth 2.1 flow. When you connect, Claude opens a Transparent Classroom login page in your browser. After you sign in, your TC API token and Firebase refresh token are encrypted (AES-256-GCM) and embedded in a signed JWT that Claude stores. The server validates that JWT on every request — no database lookup required. Your password is never stored.

Firebase ID tokens expire hourly; the server exchanges the stored refresh token for a fresh one on each request that uses Onespot tools.

## Local development

### 1. Clone and install

```bash
git clone https://github.com/tgboyles/montessori-mcp
cd montessori-mcp
npm install
```

### 2. Create `.env`

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=dev-secret-32-bytes-minimum-here!!
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
SERVER_URL=http://localhost:3000
TC_EMAIL=you@example.com
TC_PASSWORD=yourpassword
```

`REDIS_URL` is optional — when unset the server uses an in-memory store (fine for local dev on a single process).

### 3. Build and run

```bash
npm run build
node dist/index.js
```

In dev mode with `TC_EMAIL`/`TC_PASSWORD` set, the server authenticates with TC on startup and prints a Bearer token to stderr:

```
[dev] Bearer token: eyJhbGci...
```

Use that token directly in a REST client (Bruno, Insomnia, curl) to call `POST http://localhost:3000/mcp` without going through OAuth.

### Testing the full OAuth flow locally

The OAuth flow requires a publicly reachable URL. Use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Update `.env` with the ngrok URL:

```env
SERVER_URL=https://abc123.ngrok-free.app
```

Restart the server, then add `https://abc123.ngrok-free.app/mcp` as a Claude connector. The login page redirect and token exchange will all go through ngrok.

### Run tests

```bash
npm test          # all tests (unit + integration)
npm run test:unit # unit tests only (no credentials needed)
```
