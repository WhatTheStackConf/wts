import { expect, it } from "vite-plus/test";
import { isCheckinPath, protectCheckinResponse } from "~/lib/checkin-privacy";

it("keeps the secondary tools route inside the same private operational boundary", () => {
  expect(isCheckinPath("/checkin")).toBe(true);
  expect(isCheckinPath("/checkin-tools")).toBe(true);
  for (const variant of ["/checkin-tools/", "/CHECKIN-TOOLS", "/%63heckin-tools", "/CHECKIN/", "/API/CHECKIN-LOOKUP/"]) expect(isCheckinPath(variant)).toBe(true);
  expect(isCheckinPath("/checkin-tools-public")).toBe(false);
  const response = protectCheckinResponse(new Response("synthetic"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});
