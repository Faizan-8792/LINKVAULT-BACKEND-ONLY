import type { DeviceType } from "@secure-viewer/shared";

export function detectDeviceType(userAgent?: string | null): DeviceType {
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
