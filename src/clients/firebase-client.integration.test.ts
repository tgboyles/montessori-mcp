/**
 * Integration tests — hit the real Firebase / Onespot backend.
 * Skipped automatically when ONESPOT_EMAIL / ONESPOT_PASSWORD are not set.
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { FirebaseClient } from "./firebase-client.js";

const email = process.env.ONESPOT_EMAIL ?? process.env.TC_EMAIL ?? "";
const password = process.env.ONESPOT_PASSWORD ?? process.env.TC_PASSWORD ?? "";
const skip = !email || !password;

describe.skipIf(skip)("FirebaseClient (live Onespot/Firebase API)", () => {
  let fb: FirebaseClient;

  beforeAll(async () => {
    fb = new FirebaseClient();
    await fb.signIn(email, password);
    const appId = await fb.getMyAppId();
    if (!appId) throw new Error("Could not detect app ID — check credentials");
    fb.setAppId(appId);
  });

  it("authenticates and returns a user ID", () => {
    expect(fb.currentUserId).toBeTruthy();
  });

  it("getMyAppId returns a non-empty app ID", async () => {
    const appId = await fb.getMyAppId();
    expect(appId).toBeTruthy();
  });

  it("getMyProfile returns firstName and email", async () => {
    const profile = await fb.getMyProfile() as Record<string, unknown>;
    expect(profile.email).toBeTruthy();
    expect(profile.firstName).toBeTruthy();
  });

  it("getPortals returns at least one activityFeed portal", async () => {
    const portals = await fb.getPortals();
    expect(portals.length).toBeGreaterThan(0);
    const feeds = portals.filter(p => p.portalType === "activityFeed");
    expect(feeds.length).toBeGreaterThan(0);
    // activityFeed portals should have an activityFeedId populated
    expect(feeds[0].activityFeedId).toBeTruthy();
  });

  it("getPosts returns an array (may be empty) for a valid feed", async () => {
    const portals = await fb.getPortals();
    const feed = portals.find(p => p.portalType === "activityFeed" && p.activityFeedId);
    expect(feed).toBeTruthy();
    const posts = await fb.getPosts(feed!.activityFeedId!);
    expect(Array.isArray(posts)).toBe(true);
  });

  it("getNotifications returns an array with the expected shape", async () => {
    const notifications = await fb.getNotifications(5);
    expect(Array.isArray(notifications)).toBe(true);
    if (notifications.length > 0) {
      expect(notifications[0]).toHaveProperty("title");
      expect(notifications[0]).toHaveProperty("body");
      expect(notifications[0]).toHaveProperty("timestamp");
    }
  });

  it("notifications are sorted newest-first", async () => {
    const notifications = await fb.getNotifications();
    for (let i = 1; i < notifications.length; i++) {
      expect(notifications[i - 1].timestamp >= notifications[i].timestamp).toBe(true);
    }
  });
});
