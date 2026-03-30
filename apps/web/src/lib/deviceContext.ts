import type { ViewerDeviceContext } from "@secure-viewer/shared";

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

export function getViewerDeviceContext(): ViewerDeviceContext {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }

  const nav = navigator as NavigatorWithUAData;
  const hoverCapable =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover)").matches
      : undefined;
  const coarsePointer =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : undefined;

  return {
    userAgent: navigator.userAgent || undefined,
    platform: navigator.platform || undefined,
    maxTouchPoints:
      typeof navigator.maxTouchPoints === "number"
        ? navigator.maxTouchPoints
        : undefined,
    hoverCapable,
    coarsePointer,
    viewportWidth: typeof window.innerWidth === "number" ? window.innerWidth : undefined,
    viewportHeight: typeof window.innerHeight === "number" ? window.innerHeight : undefined,
    screenWidth: typeof window.screen?.width === "number" ? window.screen.width : undefined,
    screenHeight: typeof window.screen?.height === "number" ? window.screen.height : undefined,
    uaMobile:
      typeof nav.userAgentData?.mobile === "boolean"
        ? nav.userAgentData.mobile
        : undefined,
  };
}
