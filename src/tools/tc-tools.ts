import { z } from "zod";
import type { TCClient } from "../clients/tc-client.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// TC REST API access depends heavily on account role:
//   - parent: only /authenticate.json is accessible; all other endpoints return 403
//   - staff/admin: full access to children, classrooms, lessons, observations, etc.
// These tools work for any role, and the staff-only tools are labelled accordingly.

export function buildTCTools(tc: TCClient): Array<{
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: ToolHandler;
}> {
  return [
    {
      name: "tc_get_my_info",
      description: "Get the current user's Transparent Classroom profile: name, role (parent/staff/admin), school ID, and API token. Works for all account types.",
      inputSchema: z.object({}),
      handler: async () => ok(await tc.authenticate()),
    },
    {
      name: "tc_list_children",
      description: "List all children at the school. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts. If you are a parent, child data comes from the Onespot app instead.",
      inputSchema: z.object({}),
      handler: async () => ok(await tc.getChildren()),
    },
    {
      name: "tc_list_classrooms",
      description: "List all classrooms at the school. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts.",
      inputSchema: z.object({}),
      handler: async () => ok(await tc.getClassrooms()),
    },
    {
      name: "tc_list_lessons",
      description: "List lessons/presentations recorded for a specific child. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts.",
      inputSchema: z.object({
        child_id: z.number().describe("The child's numeric TC ID"),
        date_start: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        date_end: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
      }),
      handler: async (args) => {
        const { child_id, date_start, date_end } = args as {
          child_id: number;
          date_start?: string;
          date_end?: string;
        };
        return ok(await tc.getLessons(child_id, { date_start, date_end }));
      },
    },
    {
      name: "tc_list_observations",
      description: "List teacher observations for a specific child. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts.",
      inputSchema: z.object({
        child_id: z.number().describe("The child's numeric TC ID"),
        date_start: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        date_end: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
      }),
      handler: async (args) => {
        const { child_id, date_start, date_end } = args as {
          child_id: number;
          date_start?: string;
          date_end?: string;
        };
        return ok(await tc.getObservations(child_id, { date_start, date_end }));
      },
    },
    {
      name: "tc_list_events",
      description: "List school events from Transparent Classroom. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts. For parent event access, use onespot_list_events instead.",
      inputSchema: z.object({
        start_date: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        end_date: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
      }),
      handler: async (args) => {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        return ok(await tc.getEvents({ start_date, end_date }));
      },
    },
    {
      name: "tc_list_users",
      description: "List staff and users at the school. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts.",
      inputSchema: z.object({}),
      handler: async () => ok(await tc.getUsers()),
    },
    {
      name: "tc_list_conference_reports",
      description: "List conference/progress reports for a specific child. REQUIRES STAFF OR ADMIN role — returns Forbidden for parent accounts.",
      inputSchema: z.object({
        child_id: z.number().describe("The child's numeric TC ID"),
      }),
      handler: async (args) => {
        const { child_id } = args as { child_id: number };
        return ok(await tc.getConferenceReports(child_id));
      },
    },
  ];
}
