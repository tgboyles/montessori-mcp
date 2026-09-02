/**
 * Integration tests — hit the real Transparent Classroom API.
 * Skipped automatically when TC_EMAIL / TC_PASSWORD are not set.
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TCClient } from "./tc-client.js";

const skip = !process.env.TC_EMAIL || !process.env.TC_PASSWORD;

describe.skipIf(skip)("TCClient (live TC API)", () => {
  let tc: TCClient;

  beforeAll(() => {
    tc = new TCClient(process.env.TC_EMAIL!, process.env.TC_PASSWORD!);
  });

  it("authenticates and returns a valid api_token", async () => {
    const result = await tc.authenticate();
    expect(result.api_token).toBeTruthy();
    expect(result.id).toBeTypeOf("number");
    expect(result.school_id).toBeTypeOf("number");
    expect(Array.isArray(result.roles)).toBe(true);
  });

  it("getSchools returns at least the user's own school", async () => {
    const schools = await tc.getSchools();
    expect(schools.length).toBeGreaterThanOrEqual(1);
    expect(schools[0]).toHaveProperty("id");
  });

  it("getChildren returns Forbidden for parent accounts (or a list for staff)", async () => {
    try {
      const children = await tc.getChildren();
      // Staff/admin path — should be an array
      expect(Array.isArray(children)).toBe(true);
    } catch (err) {
      // Parent path — TC returns 403
      expect((err as Error).message).toContain("403");
    }
  });
});
