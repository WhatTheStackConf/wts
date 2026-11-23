import { describe, expect, it } from "vite-plus/test";
import { daysUntil } from "~/components/landing/t-minus";

describe("daysUntil", () => {
  it("counts whole days in the conference time zone", () => {
    // 23:30 UTC on 1 May is already 2 May in Skopje.
    expect(daysUntil(new Date("2027-05-01T23:30:00Z"), "2027-05-12", "Europe/Skopje")).toBe(10);
    expect(daysUntil(new Date("2027-05-01T23:30:00Z"), "2027-05-12", "UTC")).toBe(11);
  });

  it("counts across a daylight saving change", () => {
    expect(daysUntil(new Date("2027-03-20T12:00:00Z"), "2027-04-03", "Europe/Skopje")).toBe(14);
  });

  it("returns null on the day, after it, and for a malformed date", () => {
    expect(daysUntil(new Date("2027-05-12T08:00:00Z"), "2027-05-12", "Europe/Skopje")).toBeNull();
    expect(daysUntil(new Date("2027-06-01T08:00:00Z"), "2027-05-12", "Europe/Skopje")).toBeNull();
    expect(daysUntil(new Date("2027-05-01T08:00:00Z"), "12 May 2027", "Europe/Skopje")).toBeNull();
  });
});
