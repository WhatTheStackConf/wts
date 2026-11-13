import { describe, expect, it } from "vite-plus/test";
import { hudTransition } from "~/components/landing/hud-boot";

describe("hudTransition", () => {
  it("boots a block that enters the window", () => {
    expect(hudTransition({ isIntersecting: true, top: 400, viewportHeight: 900 })).toBe("on");
  });

  it("powers down a block that drops below the window, so the next climb replays the boot", () => {
    expect(hudTransition({ isIntersecting: false, top: 900, viewportHeight: 900 })).toBe("off");
  });

  it("keeps a block in the bottom margin unchanged, so its own clip cannot toggle it", () => {
    expect(hudTransition({ isIntersecting: false, top: 757, viewportHeight: 900 })).toBeNull();
  });

  it("keeps a block on after it leaves through the top of the window", () => {
    expect(hudTransition({ isIntersecting: false, top: -300, viewportHeight: 900 })).toBeNull();
  });
});
