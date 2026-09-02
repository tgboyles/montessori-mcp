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
let redisReady = false;
let memory: MemoryStore | null = null;

async function getRedis(): Promise<Redis | null> {
  if (!process.env.REDIS_URL) return null;
  if (redis && redisReady) return redis;
  if (!redis) {
    const client = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    client.on("error", (err: Error) => {
      process.stderr.write(`[kv] Redis error: ${err.message}\n`);
      redis = null;
      redisReady = false;
    });
    try {
      await client.connect();
      redis = client;
      redisReady = true;
      process.stderr.write("[kv] Redis connected\n");
    } catch (err) {
      process.stderr.write(`[kv] Redis connect failed, using in-memory: ${err}\n`);
      await client.quit().catch(() => {});
      return null;
    }
  }
  return redis;
}

function getMemory(): MemoryStore {
  if (!memory) memory = new MemoryStore();
  return memory;
}

export async function probeRedis(): Promise<void> {
  await getRedis();
}

export async function storeAuthCode(code: string, data: AuthCode): Promise<void> {
  const r = await getRedis();
  const serialized = JSON.stringify(data);
  if (r) {
    try {
      await r.setex(`auth:code:${code}`, AUTH_CODE_TTL, serialized);
      return;
    } catch (err) {
      process.stderr.write(`[kv] Redis setex failed, using in-memory: ${err}\n`);
      redis = null;
      redisReady = false;
    }
  }
  getMemory().set(`auth:code:${code}`, AUTH_CODE_TTL, serialized);
}

// Returns the code data and atomically deletes it — null if expired or already used.
export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const r = await getRedis();
  let raw: string | null = null;
  if (r) {
    try {
      raw = await r.getdel(`auth:code:${code}`);
    } catch (err) {
      process.stderr.write(`[kv] Redis getdel failed, using in-memory: ${err}\n`);
      redis = null;
      redisReady = false;
      raw = getMemory().getdel(`auth:code:${code}`);
    }
  } else {
    raw = getMemory().getdel(`auth:code:${code}`);
  }
  if (!raw) return null;
  return JSON.parse(raw) as AuthCode;
}
