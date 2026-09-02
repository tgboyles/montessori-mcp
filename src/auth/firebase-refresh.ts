const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY ?? "AIzaSyCt9hn6iIod1TQ_MYoRnNoROY4kn-fhxoc";
const TOKEN_ENDPOINT = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

interface TokenResponse {
  id_token: string;
  refresh_token: string;
  user_id: string;
}

export async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json() as TokenResponse;
  return data.id_token;
}
