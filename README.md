# Montessori MCP

An MCP (Model Context Protocol) server that connects Claude to **Onespot** (The Montessori App, by Seabird Apps) and **Transparent Classroom**. It gives Claude access to school notifications, classroom feeds, posts, events, and TC account data — all scoped to the authenticated user's own data.

## Requirements

- Node.js 22+
- An Onespot account (direct email/password login)
- A Transparent Classroom account (for `tc_get_my_info`; staff/admin accounts unlock additional TC tools)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd transparent-classroom-mcp
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Your Transparent Classroom login
TC_EMAIL=you@example.com
TC_PASSWORD=yourpassword

# Your Onespot / The Montessori App login
# If it's the same account as TC, set both to the same values
ONESPOT_EMAIL=you@example.com
ONESPOT_PASSWORD=yourpassword

# Optional: your school's Onespot app ID (auto-detected if omitted)
ONESPOT_APP_ID=
```

### 3. Build

```bash
npm run build
```

## Connecting to Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and add the `montessori` entry to `mcpServers`:

```json
{
  "mcpServers": {
    "montessori": {
      "command": "node",
      "args": ["/absolute/path/to/transparent-classroom-mcp/dist/index.js"],
      "env": {
        "TC_EMAIL": "you@example.com",
        "TC_PASSWORD": "yourpassword",
        "ONESPOT_EMAIL": "you@example.com",
        "ONESPOT_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Replace `/absolute/path/to/transparent-classroom-mcp` with the actual path (e.g. `/Users/yourname/workspace/transparent-classroom-mcp`).

Restart Claude Desktop. On startup you should see a log line like:
```
Onespot/Firebase authenticated. App ID: -OeWi3SziSn-r_kmOjBR
```

## Available Tools

### Onespot / The Montessori App

| Tool | Description |
|---|---|
| `onespot_auto_setup` | Auto-detects your school's app ID from your profile. Call this first if setup fails. |
| `onespot_get_my_profile` | Returns your Onespot profile and detected app ID. |
| `onespot_list_notifications` | School-wide push notifications — the "Important" tab in the app. This is where admin announcements like closures and building updates appear. |
| `onespot_list_portals` | All sections of the school app: feeds, chats, calendar, static pages. Shows which feeds allow parent posting. |
| `onespot_list_posts` | Recent posts in a specific activity feed (newsfeed or chat). Requires a `feed_id` from `onespot_list_portals`. |
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

> **Note for parent accounts:** TC's REST API does not grant parents access to school-wide data. The staff-only tools above will return `Forbidden`. All parent-facing school data is available through the `onespot_` tools instead.

## How it works

**Onespot** uses Firebase Realtime Database as its backend. This server authenticates with Firebase using your Onespot email/password, then reads from the `seabirdmain` Firebase project — the same data your school's app displays.

**Transparent Classroom** uses HTTP Basic Auth with your email and password to obtain an API token, which is then passed as `X-TransparentClassroomToken` on subsequent requests.

Both services authenticate as *you*, so Claude can only access data your account is already permitted to see.

## Development

```bash
# Run directly with hot reload (no build step)
npm run dev

# Build for production
npm run build

# Run built server
npm start
```
