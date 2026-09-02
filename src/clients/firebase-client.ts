// Firebase project: seabirdmain
// Public client-side constants (embedded in the Expo JS bundle).
const FIREBASE_API_KEY = "AIzaSyCt9hn6iIod1TQ_MYoRnNoROY4kn-fhxoc";
const FIREBASE_RTDB_URL = "https://seabirdmain-default-rtdb.firebaseio.com";
const FIREBASE_AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

export interface FirebaseUser {
  idToken: string;
  email: string;
  localId: string;
  refreshToken: string;
  expiresIn: string;
}

export interface OnespotPortal {
  id: string;
  name: string;
  portalType: string;
  icon?: string;
  activityFeedId?: string;
  feedType?: string;
  accountTypesAllowedToPost?: Record<string, boolean>;
  disableComments?: boolean;
}

export interface OnespotPost {
  id: string;
  message: string;
  timestamp: string;
  userID: string;
  authorName?: string;
  allowRSVP?: boolean;
  comments?: Record<string, OnespotComment>;
  likes?: Record<string, boolean>;
  attachments?: unknown[];
}

export interface OnespotComment {
  message: string;
  timestamp: string;
  userID: string;
  authorName?: string;
}

export interface OnespotNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  sender: string;
  senderName?: string;
  numberUsersSentTo?: number;
  deliveryMethod?: {
    email?: boolean;
    pushNotification?: boolean;
    textMessage?: boolean;
    phoneCall?: boolean;
  };
  url?: string;
  chatEnabled?: boolean;
  audience?: Record<string, unknown>;
}

export interface OnespotEvent {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  startTime?: string | number;
  endTime?: string | number;
  location?: string;
  allDay?: boolean;
}

export class FirebaseClient {
  private idToken: string | null = null;
  private userId: string | null = null;
  private appId: string | null = null;
  private userCache: Map<string, string> = new Map();

  static fromToken(idToken: string, userId: string, appId: string | null): FirebaseClient {
    const client = new FirebaseClient();
    client.idToken = idToken;
    client.userId = userId;
    client.appId = appId;
    return client;
  }

  // Returns the Firebase refreshToken, which is long-lived and can be stored.
  async signIn(email: string, password: string): Promise<string> {
    const res = await fetch(`${FIREBASE_AUTH_URL}?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Firebase auth failed: ${err.error?.message ?? res.statusText}`);
    }
    const data = await res.json() as FirebaseUser;
    this.idToken = data.idToken;
    this.userId = data.localId;
    return data.refreshToken;
  }

  setAppId(appId: string) {
    this.appId = appId;
  }

  private get token(): string {
    if (!this.idToken) throw new Error("Not authenticated. Call signIn first.");
    return this.idToken;
  }

  private get app(): string {
    if (!this.appId) throw new Error("No app ID set. Call setAppId first.");
    return this.appId;
  }

  get currentUserId(): string | null {
    return this.userId;
  }

  getIdToken(): string {
    return this.token;
  }

  async rtdbGet<T>(path: string): Promise<T | null> {
    const url = `${FIREBASE_RTDB_URL}${path}.json?auth=${this.token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T | null>;
  }

  private async rtdbPost<T>(path: string, data: unknown): Promise<{ name: string } & T> {
    const url = `${FIREBASE_RTDB_URL}${path}.json?auth=${this.token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`RTDB POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ name: string } & T>;
  }

  private async getUserName(uid: string): Promise<string> {
    if (this.userCache.has(uid)) return this.userCache.get(uid)!;
    try {
      const user = await this.rtdbGet<{ firstName?: string; lastName?: string; email?: string }>(`/users/${uid}`);
      const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || uid;
      this.userCache.set(uid, name);
      return name;
    } catch {
      return uid;
    }
  }

  async getMyAppId(): Promise<string | null> {
    if (!this.userId) return null;
    try {
      const user = await this.rtdbGet<{ mostRecentApp?: string }>(`/users/${this.userId}`);
      return user?.mostRecentApp ?? null;
    } catch {
      return null;
    }
  }

  async getMyProfile(): Promise<unknown> {
    if (!this.userId) throw new Error("Not authenticated.");
    return this.rtdbGet(`/users/${this.userId}`);
  }

  async getPortals(): Promise<OnespotPortal[]> {
    const metadata = await this.rtdbGet<Record<string, Record<string, unknown>>>(`/apps/${this.app}/content/allPortals/metadata`);
    if (!metadata) return [];

    const portals: OnespotPortal[] = [];

    for (const [id, v] of Object.entries(metadata)) {
      const portal: OnespotPortal = {
        id,
        name: (v.txtName ?? v.name ?? v.label ?? "Untitled") as string,
        portalType: (v.portalType ?? v.type ?? "unknown") as string,
        icon: v.icon as string | undefined,
      };

      // For activityFeed portals, fetch the activityFeed ID from content
      if (portal.portalType === "activityFeed") {
        try {
          const content = await this.rtdbGet<{
            activityFeed?: string;
            feedType?: string;
            accountTypesAllowedToPost?: Record<string, boolean>;
            disableComments?: boolean;
          }>(`/apps/${this.app}/content/allPortals/content/${id}`);
          if (content) {
            portal.activityFeedId = content.activityFeed;
            portal.feedType = content.feedType;
            portal.accountTypesAllowedToPost = content.accountTypesAllowedToPost;
            portal.disableComments = content.disableComments;
          }
        } catch {
          // ignore
        }
      }

      portals.push(portal);
    }

    return portals.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPosts(feedId: string, limit = 50): Promise<OnespotPost[]> {
    const feed = await this.rtdbGet<{ posts?: Record<string, Record<string, unknown>> }>(
      `/apps/${this.app}/activityFeeds/${feedId}`
    );
    if (!feed?.posts) return [];

    const posts: OnespotPost[] = Object.entries(feed.posts).map(([id, v]) => ({
      id,
      message: (v.message ?? "") as string,
      timestamp: (v.timestamp ?? "") as string,
      userID: (v.userID ?? "") as string,
      allowRSVP: v.allowRSVP as boolean | undefined,
      comments: v.comments as Record<string, OnespotComment> | undefined,
      likes: v.likes as Record<string, boolean> | undefined,
    }));

    const sorted = posts.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);

    // Resolve author names
    for (const post of sorted) {
      post.authorName = await this.getUserName(post.userID);
      if (post.comments) {
        for (const comment of Object.values(post.comments)) {
          comment.authorName = await this.getUserName(comment.userID);
        }
      }
    }

    return sorted;
  }

  async createPost(feedId: string, message: string): Promise<string> {
    if (!this.userId) throw new Error("Not authenticated.");
    const post = {
      message,
      userID: this.userId,
      timestamp: new Date().toISOString(),
      allowRSVP: false,
    };
    const result = await this.rtdbPost<object>(`/apps/${this.app}/activityFeeds/${feedId}/posts`, post);
    return result.name;
  }

  async addComment(feedId: string, postId: string, message: string): Promise<string> {
    if (!this.userId) throw new Error("Not authenticated.");
    const comment = {
      message,
      userID: this.userId,
      timestamp: new Date().toISOString(),
    };
    const result = await this.rtdbPost<object>(
      `/apps/${this.app}/activityFeeds/${feedId}/posts/${postId}/comments`,
      comment
    );
    return result.name;
  }

  async getNotifications(limit = 50): Promise<OnespotNotification[]> {
    const data = await this.rtdbGet<Record<string, Record<string, unknown>>>(
      `/apps/${this.app}/notifications/all`
    );
    if (!data) return [];

    const notifications: OnespotNotification[] = Object.entries(data).map(([id, v]) => ({
      id,
      title: (v.title ?? "") as string,
      body: (v.body ?? "") as string,
      timestamp: (v.timestamp ?? "") as string,
      sender: (v.sender ?? "") as string,
      numberUsersSentTo: v.numberUsersSentTo as number | undefined,
      deliveryMethod: v.deliveryMethod as OnespotNotification["deliveryMethod"],
      url: v.url as string | undefined,
      chatEnabled: v.chatEnabled as boolean | undefined,
      audience: v.audience as Record<string, unknown> | undefined,
    }));

    const sorted = notifications
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    for (const n of sorted) {
      n.senderName = await this.getUserName(n.sender);
    }

    return sorted;
  }

  async getEvents(limit = 50): Promise<OnespotEvent[]> {
    // Events portal ID for this school — check content/allPortals/content for type "events"
    // We scan portal metadata for portalType === "events"
    const metadata = await this.rtdbGet<Record<string, Record<string, unknown>>>(
      `/apps/${this.app}/content/allPortals/metadata`
    );
    if (!metadata) return [];

    const eventPortalIds = Object.entries(metadata)
      .filter(([, v]) => v.portalType === "events" || v.type === "events")
      .map(([id]) => id);

    const allEvents: OnespotEvent[] = [];
    for (const portalId of eventPortalIds) {
      try {
        const content = await this.rtdbGet<{ events?: Record<string, Record<string, unknown>> }>(
          `/apps/${this.app}/content/allPortals/content/${portalId}`
        );
        if (content?.events) {
          for (const [id, v] of Object.entries(content.events)) {
            allEvents.push({ id, ...v } as OnespotEvent);
          }
        }
      } catch {
        // ignore
      }
    }

    return allEvents.slice(0, limit);
  }
}
