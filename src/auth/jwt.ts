import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  tc: string;  // encrypted { apiToken, schoolId }
  fb?: string; // encrypted { refreshToken, userId, appId }
}

export interface TcSession {
  apiToken: string;
  schoolId: number;
}

export interface FbSession {
  refreshToken: string;
  userId: string;
  appId: string | null;
}

const TOKEN_EXPIRY = "30d";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: Omit<AccessTokenPayload, "iss" | "iat">): Promise<string> {
  const issuer = process.env.SERVER_URL ?? "";
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuer(issuer)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const issuer = process.env.SERVER_URL ?? "";
  const { payload } = await jwtVerify(token, getSecret(), { issuer });
  return payload as AccessTokenPayload;
}
