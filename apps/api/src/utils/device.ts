import type { DeviceType, ViewerDeviceContext } from "@secure-viewer/shared";

function detectFromUserAgent(userAgent?: string | null): DeviceType {
  if (!userAgent) {
    return "unknown";
  }

  const agent = userAgent.toLowerCase();

  if (/iphone|android.+mobile|windows phone|ipod/.test(agent)) {
    return "mobile";
  }
  if (/ipad|tablet|android(?!.*mobile)/.test(agent)) {
    return "tablet";
  }
  if (/windows nt|mac os x|linux x86_64|x11|cros/.test(agent)) {
    return "desktop";
  }

  return "unknown";
}

function classifyTouchFormFactor(deviceContext: ViewerDeviceContext): DeviceType {
  const widths = [
    deviceContext.viewportWidth,
    deviceContext.viewportHeight,
    deviceContext.screenWidth,
    deviceContext.screenHeight,
  ].filter((value): value is number => typeof value === "number" && value > 0);

  if (widths.length === 0) {
    return "mobile";
  }

  return Math.min(...widths) >= 700 ? "tablet" : "mobile";
}

function detectFromClientContext(deviceContext?: ViewerDeviceContext | null): DeviceType {
  if (!deviceContext) {
    return "unknown";
  }

  const platform = deviceContext.platform?.toLowerCase() ?? "";
  const userAgent = deviceContext.userAgent?.toLowerCase() ?? "";
  const touchPoints = deviceContext.maxTouchPoints ?? 0;
  const hoverCapable = deviceContext.hoverCapable;
  const coarsePointer = deviceContext.coarsePointer;

  if (deviceContext.uaMobile) {
    return "mobile";
  }

  if (
    /iphone|ipod|windows phone/.test(platform) ||
    /iphone|ipod|windows phone/.test(userAgent)
  ) {
    return "mobile";
  }

  if (/ipad/.test(platform) || /ipad/.test(userAgent)) {
    return "tablet";
  }

  if (/android/.test(platform) || /android/.test(userAgent)) {
    return classifyTouchFormFactor(deviceContext);
  }

  if (platform === "macintel" && touchPoints > 1) {
    return "tablet";
  }

  if (touchPoints > 1 && coarsePointer === true && hoverCapable === false) {
    return classifyTouchFormFactor(deviceContext);
  }

  if (hoverCapable === true && coarsePointer === false) {
    return "desktop";
  }

  return "unknown";
}

export function detectDeviceType(
  userAgent?: string | null,
  deviceContext?: ViewerDeviceContext | null,
): DeviceType {
  const userAgentType = detectFromUserAgent(userAgent);
  const clientType = detectFromClientContext(deviceContext);

  if (clientType === "mobile" || clientType === "tablet") {
    return clientType;
  }

  if (userAgentType === "mobile" || userAgentType === "tablet") {
    return userAgentType;
  }

  if (clientType === "desktop") {
    return "desktop";
  }

  if (userAgentType === "desktop") {
    return "desktop";
  }

  return "unknown";
}
