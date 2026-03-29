import { describe, expect, it } from "vitest";
import { detectDeviceType } from "./device.js";

describe("detectDeviceType", () => {
  it("classifies mobile browsers", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe("mobile");
  });

  it("classifies desktop browsers", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
      ),
    ).toBe("desktop");
  });
});
