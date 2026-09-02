import { z } from "zod";
import type { FirebaseClient } from "../clients/firebase-client.js";
import type { ToolHandler } from "./tc-tools.js";

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function buildOnespotTools(fb: FirebaseClient): Array<{
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: ToolHandler;
}> {
  return [
    {
      name: "onespot_set_app_id",
      description: "Set the Onespot school app ID. If you don't know it, call onespot_get_my_profile first — the app ID is in the 'mostRecentApp' field.",
      inputSchema: z.object({
        app_id: z.string().describe("The Firebase app ID for the school (e.g. '-OeWi3SziSn-r_kmOjBR')"),
      }),
      handler: async (args) => {
        const { app_id } = args as { app_id: string };
        fb.setAppId(app_id);
        return ok({ success: true, app_id });
      },
    },
    {
      name: "onespot_get_my_profile",
      description: "Get the current user's Onespot profile, including their app ID (mostRecentApp) and Transparent Classroom data.",
      inputSchema: z.object({}),
      handler: async () => {
        const [profile, appId] = await Promise.all([
          fb.getMyProfile(),
          fb.getMyAppId(),
        ]);
        return ok({ profile, detected_app_id: appId });
      },
    },
    {
      name: "onespot_auto_setup",
      description: "Automatically detect and set the school app ID from the user's profile. Call this first to configure Onespot before using other onespot_ tools.",
      inputSchema: z.object({}),
      handler: async () => {
        const appId = await fb.getMyAppId();
        if (!appId) throw new Error("Could not detect app ID from user profile.");
        fb.setAppId(appId);
        return ok({ success: true, app_id: appId });
      },
    },
    {
      name: "onespot_list_portals",
      description: "List all sections (portals) of the school app. Activity feed portals are the message boards and chats. Shows which portals allow parent posting.",
      inputSchema: z.object({}),
      handler: async () => {
        const portals = await fb.getPortals();
        return ok(portals.map(p => ({
          id: p.id,
          name: p.name,
          type: p.portalType,
          feed_id: p.activityFeedId,
          feed_type: p.feedType,
          parent_can_post: p.accountTypesAllowedToPost?.parent ?? null,
          comments_disabled: p.disableComments ?? false,
        })));
      },
    },
    {
      name: "onespot_list_posts",
      description: "List recent posts in an activity feed (message board or chat). Use onespot_list_portals to get feed IDs.",
      inputSchema: z.object({
        feed_id: z.string().describe("The activityFeed ID from onespot_list_portals (the 'feed_id' field)"),
        limit: z.number().optional().default(20).describe("Max number of posts to return (default 20)"),
      }),
      handler: async (args) => {
        const { feed_id, limit } = args as { feed_id: string; limit?: number };
        const posts = await fb.getPosts(feed_id, limit ?? 20);
        return ok(posts.map(p => ({
          id: p.id,
          author: p.authorName ?? p.userID,
          message: p.message,
          timestamp: p.timestamp,
          comment_count: Object.keys(p.comments ?? {}).length,
          like_count: Object.keys(p.likes ?? {}).length,
        })));
      },
    },
    {
      name: "onespot_get_post",
      description: "Get a specific post including all comments and their authors.",
      inputSchema: z.object({
        feed_id: z.string().describe("The activityFeed ID"),
        post_id: z.string().describe("The post ID from onespot_list_posts"),
      }),
      handler: async (args) => {
        const { feed_id, post_id } = args as { feed_id: string; post_id: string };
        const posts = await fb.getPosts(feed_id, 1000);
        const post = posts.find(p => p.id === post_id);
        if (!post) return ok({ error: "Post not found" });
        return ok({
          id: post.id,
          author: post.authorName ?? post.userID,
          message: post.message,
          timestamp: post.timestamp,
          comments: Object.entries(post.comments ?? {}).map(([id, c]) => ({
            id,
            author: c.authorName ?? c.userID,
            message: c.message,
            timestamp: c.timestamp,
          })),
          likes: Object.keys(post.likes ?? {}).length,
        });
      },
    },
    {
      name: "onespot_post_message",
      description: "Post a new message to an activity feed. Check onespot_list_portals first to confirm the feed allows parent posting.",
      inputSchema: z.object({
        feed_id: z.string().describe("The activityFeed ID to post to"),
        message: z.string().describe("The message text to post"),
      }),
      handler: async (args) => {
        const { feed_id, message } = args as { feed_id: string; message: string };
        const postId = await fb.createPost(feed_id, message);
        return ok({ success: true, post_id: postId, feed_id });
      },
    },
    {
      name: "onespot_add_comment",
      description: "Add a comment to an existing post in an activity feed.",
      inputSchema: z.object({
        feed_id: z.string().describe("The activityFeed ID the post belongs to"),
        post_id: z.string().describe("The post ID to comment on"),
        message: z.string().describe("The comment text"),
      }),
      handler: async (args) => {
        const { feed_id, post_id, message } = args as {
          feed_id: string;
          post_id: string;
          message: string;
        };
        const commentId = await fb.addComment(feed_id, post_id, message);
        return ok({ success: true, comment_id: commentId });
      },
    },
    {
      name: "onespot_list_notifications",
      description: "List school-wide notifications/announcements sent by administrators — these appear in the 'Important' tab of the app's Messages section. Includes push-only messages that don't go via email.",
      inputSchema: z.object({
        limit: z.number().optional().default(20).describe("Max number of notifications to return (default 20, newest first)"),
      }),
      handler: async (args) => {
        const { limit } = args as { limit?: number };
        const notifications = await fb.getNotifications(limit ?? 20);
        return ok(notifications.map(n => ({
          id: n.id,
          title: n.title,
          body: n.body,
          timestamp: n.timestamp,
          sender: n.senderName ?? n.sender,
          sent_to: n.numberUsersSentTo,
          delivery: n.deliveryMethod,
          url: n.url,
          chat_enabled: n.chatEnabled,
        })));
      },
    },
    {
      name: "onespot_list_events",
      description: "List events from the school calendar in Onespot.",
      inputSchema: z.object({
        limit: z.number().optional().default(50).describe("Max number of events to return"),
      }),
      handler: async (args) => {
        const { limit } = args as { limit?: number };
        return ok(await fb.getEvents(limit ?? 50));
      },
    },
    {
      name: "onespot_explore_path",
      description: "Explore any path in the Firebase Realtime Database. Useful for discovering data. Path starts with '/' (e.g. '/apps/-OeWi3SziSn-r_kmOjBR/content/globalConfig').",
      inputSchema: z.object({
        path: z.string().describe("RTDB path starting with '/'"),
      }),
      handler: async (args) => {
        const { path } = args as { path: string };
        const data = await fb.rtdbGet<unknown>(path);
        if (data && typeof data === "object") {
          const keys = Object.keys(data as object);
          if (keys.length > 20) {
            const sample: Record<string, unknown> = {};
            for (const k of keys.slice(0, 5)) {
              sample[k] = (data as Record<string, unknown>)[k];
            }
            return ok({ note: `${keys.length} items, showing first 5`, sample });
          }
        }
        return ok(data);
      },
    },
  ];
}
