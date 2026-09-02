import { describe, it, expect, vi, beforeEach } from "vitest";
import { TCClient } from "./tc-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const AUTH_RESPONSE = {
  api_token: "test-token-abc",
  id: 601144,
  first_name: "Thomas",
  last_name: "Boyles",
  roles: ["parent"],
  school_id: 466,
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("TCClient.authenticate", () => {
  it("sends Basic auth with base64-encoded credentials", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE));
    const tc = new TCClient("user@example.com", "mypassword");
    await tc.authenticate();

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.transparentclassroom.com/api/v1/authenticate.json");
    const expected = "Basic " + Buffer.from("user@example.com:mypassword").toString("base64");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(expected);
  });

  it("returns user profile data", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE));
    const tc = new TCClient("user@example.com", "pass");
    const result = await tc.authenticate();
    expect(result.first_name).toBe("Thomas");
    expect(result.roles).toEqual(["parent"]);
    expect(result.school_id).toBe(466);
  });

  it("auto-sets school_id from authenticate response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE));
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // children call

    const tc = new TCClient("user@example.com", "pass");
    await tc.authenticate();
    await tc.getChildren(); // should not throw about missing school_id

    const childrenCall = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(childrenCall[0]).toContain("school_id=466");
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ errors: [{ title: "Unauthorized", status: 401 }] }, 401)
    );
    const tc = new TCClient("bad@example.com", "wrong");
    await expect(tc.authenticate()).rejects.toThrow("401");
  });
});

describe("TCClient lazy authentication", () => {
  it("calls authenticate automatically before the first request", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE)); // authenticate
    mockFetch.mockResolvedValueOnce(jsonResponse([]));             // children

    const tc = new TCClient("user@example.com", "pass");
    await tc.getChildren();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain("authenticate");
    expect(mockFetch.mock.calls[1][0]).toContain("children");
  });

  it("does not re-authenticate on subsequent calls", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE));
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse([])));

    const tc = new TCClient("user@example.com", "pass");
    await tc.getChildren();
    await tc.getClassrooms();

    const authCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("authenticate")
    );
    expect(authCalls).toHaveLength(1);
  });
});

describe("TCClient requests", () => {
  async function authenticatedClient(): Promise<TCClient> {
    mockFetch.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE));
    const tc = new TCClient("user@example.com", "pass");
    await tc.authenticate();
    return tc;
  }

  it("uses X-TransparentClassroomToken header (not Basic auth) for API calls", async () => {
    const tc = await authenticatedClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await tc.getChildren();

    const [, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-TransparentClassroomToken"]).toBe("test-token-abc");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("includes school_id in children request", async () => {
    const tc = await authenticatedClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await tc.getChildren();

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("school_id=466");
  });

  it("passes date filters to getLessons", async () => {
    const tc = await authenticatedClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await tc.getLessons(123, { date_start: "2026-01-01", date_end: "2026-06-30" });

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("child_id=123");
    expect(url).toContain("date_start=2026-01-01");
    expect(url).toContain("date_end=2026-06-30");
  });

  it("getSchools falls back to school from auth when forbidden", async () => {
    const tc = await authenticatedClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ title: "Forbidden" }] }, 403));
    const schools = await tc.getSchools();

    expect(schools).toEqual([{ id: 466, name: "School 466" }]);
  });

  it("setSchoolId overrides the auto-detected school", async () => {
    const tc = await authenticatedClient();
    tc.setSchoolId(999);
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await tc.getChildren();

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("school_id=999");
  });
});
