import { describe, it, expect, vi, beforeEach } from "vitest";
import { FirebaseClient } from "./firebase-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SIGN_IN_RESPONSE = {
  idToken: "firebase-id-token-xyz",
  email: "user@example.com",
  localId: "uid-abc123",
  refreshToken: "refresh-token",
  expiresIn: "3600",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("FirebaseClient.signIn", () => {
  it("posts to Firebase identity toolkit with email and password", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "password123");

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("identitytoolkit.googleapis.com");
    expect(url).toContain("signInWithPassword");
    const body = JSON.parse(opts.body as string);
    expect(body.email).toBe("user@example.com");
    expect(body.password).toBe("password123");
    expect(body.returnSecureToken).toBe(true);
  });

  it("stores the user ID after sign-in", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "password123");
    expect(fb.currentUserId).toBe("uid-abc123");
  });

  it("throws with the Firebase error message on failure", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: "EMAIL_NOT_FOUND" } }, 400)
    );
    const fb = new FirebaseClient();
    await expect(fb.signIn("bad@example.com", "pass")).rejects.toThrow("EMAIL_NOT_FOUND");
  });
});

describe("FirebaseClient.rtdbGet", () => {
  async function signedInClient(): Promise<FirebaseClient> {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    return fb;
  }

  it("appends .json and auth token to RTDB path", async () => {
    const fb = await signedInClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ key: "value" }));
    await fb.rtdbGet("/some/path");

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("seabirdmain-default-rtdb.firebaseio.com");
    expect(url).toContain("/some/path.json");
    expect(url).toContain("auth=firebase-id-token-xyz");
  });

  it("throws if not authenticated", async () => {
    const fb = new FirebaseClient();
    await expect(fb.rtdbGet("/some/path")).rejects.toThrow("Not authenticated");
  });

  it("throws on non-OK RTDB response", async () => {
    const fb = await signedInClient();
    mockFetch.mockResolvedValueOnce(
      new Response('{"error":"Permission denied"}', { status: 401 })
    );
    await expect(fb.rtdbGet("/restricted")).rejects.toThrow("401");
  });
});

describe("FirebaseClient.getPosts", () => {
  async function clientWithApp(): Promise<FirebaseClient> {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    fb.setAppId("app-123");
    return fb;
  }

  it("returns empty array when feed has no posts", async () => {
    const fb = await clientWithApp();
    mockFetch.mockResolvedValueOnce(jsonResponse({ subscribers: { uid1: true } }));
    const posts = await fb.getPosts("feed-456");
    expect(posts).toEqual([]);
  });

  it("returns empty array when feed does not exist", async () => {
    const fb = await clientWithApp();
    mockFetch.mockResolvedValueOnce(jsonResponse(null));
    const posts = await fb.getPosts("feed-456");
    expect(posts).toEqual([]);
  });

  it("sorts posts newest-first", async () => {
    const fb = await clientWithApp();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        posts: {
          post1: { message: "older", timestamp: "2026-08-20T10:00:00.000Z", userID: "u1" },
          post2: { message: "newer", timestamp: "2026-08-25T10:00:00.000Z", userID: "u1" },
          post3: { message: "oldest", timestamp: "2026-08-15T10:00:00.000Z", userID: "u1" },
        },
      })
    );
    // getUserName calls for each post
    mockFetch.mockResolvedValue(jsonResponse({ firstName: "Alice", lastName: "Smith" }));

    const posts = await fb.getPosts("feed-456");
    expect(posts[0].message).toBe("newer");
    expect(posts[1].message).toBe("older");
    expect(posts[2].message).toBe("oldest");
  });

  it("respects the limit parameter", async () => {
    const posts: Record<string, object> = {};
    for (let i = 0; i < 10; i++) {
      posts[`post${i}`] = {
        message: `msg ${i}`,
        timestamp: `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        userID: "u1",
      };
    }
    const fb = await clientWithApp();
    mockFetch.mockResolvedValueOnce(jsonResponse({ posts }));
    mockFetch.mockResolvedValue(jsonResponse(null)); // user lookups

    const result = await fb.getPosts("feed-456", 3);
    expect(result).toHaveLength(3);
  });

  it("reads posts from the correct RTDB path", async () => {
    const fb = await clientWithApp();
    mockFetch.mockResolvedValueOnce(jsonResponse(null));
    await fb.getPosts("feed-xyz");

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("/apps/app-123/activityFeeds/feed-xyz.json");
  });
});

describe("FirebaseClient.createPost", () => {
  it("POSTs to the correct activityFeed path with message and userId", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    fb.setAppId("app-123");

    mockFetch.mockResolvedValueOnce(jsonResponse({ name: "new-post-id" }));
    const postId = await fb.createPost("feed-abc", "Hello world");

    const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/apps/app-123/activityFeeds/feed-abc/posts.json");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.message).toBe("Hello world");
    expect(body.userID).toBe("uid-abc123");
    expect(postId).toBe("new-post-id");
  });
});

describe("FirebaseClient.addComment", () => {
  it("POSTs to the correct post comments path", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    fb.setAppId("app-123");

    mockFetch.mockResolvedValueOnce(jsonResponse({ name: "new-comment-id" }));
    const commentId = await fb.addComment("feed-abc", "post-xyz", "Great post!");

    const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/apps/app-123/activityFeeds/feed-abc/posts/post-xyz/comments.json");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.message).toBe("Great post!");
    expect(commentId).toBe("new-comment-id");
  });
});

describe("FirebaseClient.getNotifications", () => {
  it("returns notifications sorted newest-first", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    fb.setAppId("app-123");

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        "notif-1": {
          title: "Snow Day",
          body: "Schools closed.",
          timestamp: "2026-02-04T22:39:17.538Z",
          sender: "uid-sender",
          numberUsersSentTo: 5,
          deliveryMethod: { pushNotification: true },
        },
        "notif-2": {
          title: "MAC Update",
          body: "Sprinkler issue.",
          timestamp: "2026-09-01T21:48:22.011Z",
          sender: "uid-sender2",
          numberUsersSentTo: 337,
          deliveryMethod: { pushNotification: true },
        },
      })
    );
    mockFetch.mockResolvedValue(jsonResponse(null)); // user lookups

    const notifications = await fb.getNotifications();
    expect(notifications[0].title).toBe("MAC Update");
    expect(notifications[1].title).toBe("Snow Day");
  });

  it("reads from the correct RTDB path", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");
    fb.setAppId("app-123");
    mockFetch.mockResolvedValueOnce(jsonResponse(null));

    await fb.getNotifications();

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("/apps/app-123/notifications/all.json");
  });
});

describe("FirebaseClient.getMyAppId", () => {
  it("returns mostRecentApp from user profile", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SIGN_IN_RESPONSE));
    const fb = new FirebaseClient();
    await fb.signIn("user@example.com", "pass");

    mockFetch.mockResolvedValueOnce(jsonResponse({ mostRecentApp: "-OeWi3SziSn-r_kmOjBR" }));
    const appId = await fb.getMyAppId();
    expect(appId).toBe("-OeWi3SziSn-r_kmOjBR");
  });

  it("returns null when not authenticated", async () => {
    const fb = new FirebaseClient();
    const appId = await fb.getMyAppId();
    expect(appId).toBeNull();
  });
});
