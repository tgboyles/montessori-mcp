import { Redis } from "ioredis";

export interface AuthCode {
  codeChallenge: string;
  clientId: string;
  redirectUri: string;
  tcPayload: string;
  fbPayload?: string;
}

const AUTH_CODE_TTL = 60; // seconds

// In-memory fallback for local dev (when REDIS_URL is not set).
class MemoryStore {
  private store = new Map<string, { value: string; expiresAt: number }>();

  set(key: string, ttlSeconds: number, value: string): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  getdel(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    this.store.delete(key);
    if (Date.now() > entry.expiresAt) return null;
    return entry.value;
  }
}

let redis: Redis | null = null;
let memory: MemoryStore | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    redis.on("error", (err: Error) => {
      process.stderr.write(`[kv] Redis error (using in-memory fallback): ${err.message}\n`);
      redis = null;
    });
  }
  return redis;
}

function getMemory(): MemoryStore {
  if (!memory) memory = new MemoryStore();
  return memory;
}

export async function storeAuthCode(code: string, data: AuthCode): Promise<void> {
  const r = getRedis();
  const serialized = JSON.stringify(data);
  if (r) {
    try {
      await r.setex(`auth:code:${code}`, AUTH_CODE_TTL, serialized);
      return;
    } catch (err) {
      process.stderr.write(`[kv] Redis setex failed, using in-memory: ${err}\n`);
      redis = null;
    }
  }
  getMemory().set(`auth:code:${code}`, AUTH_CODE_TTL, serialized);
}

// Returns the code data and atomically deletes it — null if expired or already used.
export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const r = getRedis();
  let raw: string | null = null;
  if (r) {
    try {
      raw = await r.getdel(`auth:code:${code}`);
    } catch (err) {
      process.stderr.write(`[kv] Redis getdel failed, using in-memory: ${err}\n`);
      redis = null;
      raw = getMemory().getdel(`auth:code:${code}`);
    }
  } else {
    raw = getMemory().getdel(`auth:code:${code}`);
  }
  if (!raw) return null;
  return JSON.parse(raw) as AuthCode;
}
