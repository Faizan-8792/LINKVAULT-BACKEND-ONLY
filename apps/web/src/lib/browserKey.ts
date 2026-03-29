const BROWSER_KEY_STORAGE = "linkvault-browser-key";

function createKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bk-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function getOrCreateBrowserKey() {
  if (typeof window === "undefined") {
    return "server-render";
  }

  const current = window.localStorage.getItem(BROWSER_KEY_STORAGE);
  if (current) {
    return current;
  }

  const next = createKey();
  window.localStorage.setItem(BROWSER_KEY_STORAGE, next);
  return next;
}
