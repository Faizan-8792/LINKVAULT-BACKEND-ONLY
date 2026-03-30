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

  it("blocks phones that request desktop mode", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
        {
          userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36",
          platform: "Linux armv81",
          maxTouchPoints: 5,
          hoverCapable: false,
          coarsePointer: true,
          viewportWidth: 412,
          viewportHeight: 915,
          screenWidth: 412,
          screenHeight: 915,
          uaMobile: true,
        },
      ),
    ).toBe("mobile");
  });

  it("blocks ipad desktop mode", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
          platform: "MacIntel",
          maxTouchPoints: 5,
          hoverCapable: false,
          coarsePointer: true,
          viewportWidth: 820,
          viewportHeight: 1180,
          screenWidth: 820,
          screenHeight: 1180,
        },
      ),
    ).toBe("tablet");
  });

  it("keeps touch-enabled laptops classified as desktop", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
        {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
          platform: "Win32",
          maxTouchPoints: 10,
          hoverCapable: true,
          coarsePointer: false,
          viewportWidth: 1440,
          viewportHeight: 900,
          screenWidth: 1440,
          screenHeight: 900,
          uaMobile: false,
        },
      ),
    ).toBe("desktop");
  });
});
