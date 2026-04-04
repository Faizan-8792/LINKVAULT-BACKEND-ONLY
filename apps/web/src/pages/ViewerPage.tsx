import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Headphones,
  Image as ImageIcon,
  Monitor,
  PlayCircle,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { PublicLinkPayload, PublicMobilePayload, SecureAsset } from "@secure-viewer/shared";
import { api } from "../lib/api";
import { getViewerDeviceContext } from "../lib/deviceContext";

type ValidationState =
  | { kind: "loading" }
  | { kind: "mobile"; message: string; replacementKind: PublicMobilePayload["replacementKind"]; replacementUrl?: string }
  | { kind: "ready"; link: PublicLinkPayload };

type SessionState = {
  sessionId: string;
  warningCount: number;
  currentAssetIndex: number;
  assets: SecureAsset[];
  completedAssetIds: string[];
  streamTickets: Record<string, string>;
  fullscreenAccepted?: boolean;
};

const DEAD_LINK_REDIRECT_URL = "https://linkvault-expired-link.invalid";
const AUTO_OPEN_DELAY_MS = 5000;
const VALIDATION_CACHE_TTL_MS = 3000;
const validationRequestCache = new Map<string, { createdAt: number; promise: Promise<any> }>();

function loadValidatedLink(token: string) {
  const cached = validationRequestCache.get(token);
  if (cached && Date.now() - cached.createdAt < VALIDATION_CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = api
    .post("/api/public/validate-link", {
      token,
      deviceContext: getViewerDeviceContext(),
    })
    .then((response) => response.data);

  validationRequestCache.set(token, { createdAt: Date.now(), promise });
  window.setTimeout(() => {
    const current = validationRequestCache.get(token);
    if (current?.promise === promise) {
      validationRequestCache.delete(token);
    }
  }, VALIDATION_CACHE_TTL_MS);

  return promise;
}

export function ViewerPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [validationState, setValidationState] = useState<ValidationState>({ kind: "loading" });
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [warningOverlay, setWarningOverlay] = useState<string | null>(null);
  const [resumeMode, setResumeMode] = useState<"warning" | "escape" | null>(null);
  const [resumeAllowed, setResumeAllowed] = useState(false);
  const [contentHidden, setContentHidden] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isOpeningContent, setIsOpeningContent] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const completedFinalization = useRef(false);
  const autoOpenTimerRef = useRef<number | null>(null);
  const sessionStateRef = useRef<SessionState | null>(null);
  const isOpeningContentRef = useRef(false);
  const lastProgressByAssetRef = useRef<Record<string, number>>({});

  const cancelAutoOpenCountdown = useCallback(() => {
    if (autoOpenTimerRef.current !== null) {
      window.clearTimeout(autoOpenTimerRef.current);
      autoOpenTimerRef.current = null;
    }
  }, []);

  const reportSuspicious = useCallback(
    async (eventName: string, customMessage?: string) => {
      const session = sessionStateRef.current;
      if (!session) {
        return;
      }

      setContentHidden(true);
      try {
        const response = await api.post("/api/public/report-suspicious", {
          sessionId: session.sessionId,
          event: eventName,
        });

        if (response.data.linkExpired || response.data.destroyed) {
          redirectToDeadLinkPage();
          return;
        }

        if (response.data.sessionEnded) {
          setSessionState(null);
          setWarningOverlay(response.data.message);
          setResumeMode(null);
          setResumeAllowed(false);
          setContentHidden(false);
          return;
        }

        setSessionState((current) =>
          current
            ? {
                ...current,
                warningCount:
                  typeof response.data.warningCount === "number"
                    ? response.data.warningCount
                    : current.warningCount,
              }
            : current,
        );
        setResumeAllowed(Boolean(response.data.resumeAllowed));
        setResumeMode(eventName === "escape-key" ? "escape" : response.data.resumeAllowed ? "warning" : null);
        setWarningOverlay(customMessage ?? response.data.message);
      } catch {
        redirectToDeadLinkPage();
      }
    },
    [],
  );

  const resumeViewing = useCallback(async () => {
    const session = sessionStateRef.current;
    if (!session) {
      return;
    }

    setIsResuming(true);
    try {
      await api.post("/api/public/resume-session", {
        sessionId: session.sessionId,
      });
      setWarningOverlay(null);
      setResumeMode(null);
      setResumeAllowed(false);
      setContentHidden(false);
    } catch (error: any) {
      const message = String(error?.response?.data?.message ?? "");
      if (message.toLowerCase().includes("expired")) {
        redirectToDeadLinkPage();
        return;
      }
      setWarningOverlay(message || "Unable to resume secure viewing.");
    } finally {
      setIsResuming(false);
    }
  }, []);

  const reportSessionProgress = useCallback(
    async (assetId: string, elapsedSeconds: number, durationSeconds?: number | null) => {
      const session = sessionStateRef.current;
      if (!session) {
        return;
      }

      const nextElapsedSeconds = Math.max(0, Math.floor(elapsedSeconds));
      const cacheKey = `${session.sessionId}:${assetId}`;
      const lastElapsedSeconds = lastProgressByAssetRef.current[cacheKey];

      if (lastElapsedSeconds === nextElapsedSeconds) {
        return;
      }

      lastProgressByAssetRef.current[cacheKey] = nextElapsedSeconds;

      try {
        await api.post("/api/public/session-progress", {
          sessionId: session.sessionId,
          assetId,
          elapsedSeconds: nextElapsedSeconds,
          durationSeconds:
            typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
              ? durationSeconds
              : undefined,
        });
      } catch (error: any) {
        const message = String(error?.response?.data?.message ?? "");
        if (message.toLowerCase().includes("expired")) {
          redirectToDeadLinkPage();
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function validate() {
      try {
        const response = await loadValidatedLink(token);
        if (cancelled) {
          return;
        }

        if (response.mode === "mobile") {
          setValidationState({
            kind: "mobile",
            message: response.message,
            replacementKind: response.replacementKind ?? "permanent-expired",
            replacementUrl: response.replacementUrl,
          });
          return;
        }

        setValidationState({ kind: "ready", link: response.link });
      } catch {
        redirectToDeadLinkPage();
      }
    }

    void validate();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    isOpeningContentRef.current = isOpeningContent;
  }, [isOpeningContent]);

  useEffect(() => cancelAutoOpenCountdown, [cancelAutoOpenCountdown]);

  useViewerSecurity({
    enabled: Boolean(sessionState),
    fullscreenRequired: Boolean(sessionState?.fullscreenAccepted),
    onSuspicious: (eventName) => reportSuspicious(eventName),
  });

  useEffect(() => {
    if (!sessionState) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      void reportSuspicious("escape-key");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reportSuspicious, sessionState]);

  useEffect(() => {
    if (!sessionState || contentHidden) {
      return;
    }

    const onButtonTap = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) {
        return;
      }

      if (button.dataset.allowSecureAction === "true") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void reportSuspicious("button-tap-attempt", "Not allowed");
    };

    document.addEventListener("click", onButtonTap, true);
    return () => document.removeEventListener("click", onButtonTap, true);
  }, [contentHidden, reportSuspicious, sessionState]);

  useEffect(() => {
    const session = sessionState;
    if (!session || completedFinalization.current) {
      return;
    }

    if (session.currentAssetIndex >= session.assets.length && !isFinalizing) {
      completedFinalization.current = true;
      setIsFinalizing(true);
      void api
        .post("/api/public/consume-content", { sessionId: session.sessionId })
        .then((response) => {
          if (response.data.expired) {
            redirectToDeadLinkPage();
            return;
          }
          setWarningOverlay(response.data.message);
          setResumeMode(null);
          setResumeAllowed(false);
          setContentHidden(true);
        })
        .catch(() => redirectToDeadLinkPage())
        .finally(() => setIsFinalizing(false));
    }
  }, [isFinalizing, sessionState]);

  const currentAsset = useMemo(
    () => (sessionState ? sessionState.assets[sessionState.currentAssetIndex] ?? null : null),
    [sessionState],
  );

  function assetUrl(assetId: string) {
    if (!sessionState) {
      return "";
    }
    const base = api.defaults.baseURL ?? "";
    const ticket = encodeURIComponent(sessionState.streamTickets[assetId]);
    return `${base}/api/public/assets/${assetId}/stream?sessionId=${sessionState.sessionId}&ticket=${ticket}`;
  }

  function redirectToDeadLinkPage() {
    window.location.replace(DEAD_LINK_REDIRECT_URL);
  }

  const openContent = useCallback(async () => {
    try {
      const fullscreenAccepted = await requestFullscreenBestEffort();
      const response = await api.post("/api/public/start-session", {
        token,
        fullscreenAccepted,
        deviceContext: getViewerDeviceContext(),
      });

      if (response.data.mode === "mobile") {
        setValidationState({
          kind: "mobile",
          message: response.data.message,
          replacementKind: response.data.replacementKind ?? "permanent-expired",
          replacementUrl: response.data.replacementUrl,
        });
        setSessionState(null);
        setWarningOverlay(null);
        setResumeMode(null);
        setResumeAllowed(false);
        return;
      }

      setSessionState({ ...response.data, fullscreenAccepted });
      lastProgressByAssetRef.current = {};
      completedFinalization.current = false;
      setWarningOverlay(null);
      setResumeMode(null);
      setResumeAllowed(false);
      setContentHidden(false);
    } catch (error: any) {
      const message = String(error?.response?.data?.message ?? "");
      if (message.toLowerCase().includes("expired")) {
        redirectToDeadLinkPage();
        return;
      }
      setWarningOverlay(message || "Unable to open content right now.");
    }
  }, [token]);

  const triggerOpenContent = useCallback(() => {
    if (isOpeningContentRef.current || sessionStateRef.current) {
      return;
    }

    cancelAutoOpenCountdown();
    isOpeningContentRef.current = true;
    setIsOpeningContent(true);
    void openContent().finally(() => {
      isOpeningContentRef.current = false;
      setIsOpeningContent(false);
    });
  }, [cancelAutoOpenCountdown, openContent]);

  useEffect(() => {
    if (validationState.kind !== "ready" || sessionState) {
      cancelAutoOpenCountdown();
      return;
    }

    if (autoOpenTimerRef.current !== null || isOpeningContentRef.current) {
      return;
    }

    autoOpenTimerRef.current = window.setTimeout(() => {
      autoOpenTimerRef.current = null;
      triggerOpenContent();
    }, AUTO_OPEN_DELAY_MS);

    return cancelAutoOpenCountdown;
  }, [cancelAutoOpenCountdown, sessionState, triggerOpenContent, validationState.kind]);

  async function markAssetProgress(assetId: string, event: "opened" | "completed") {
    const session = sessionStateRef.current;
    if (!session) {
      return;
    }

    const response = await api.post("/api/public/asset-progress", {
      sessionId: session.sessionId,
      assetId,
      event,
    });

    setSessionState((current) =>
      current
        ? {
            ...current,
            currentAssetIndex: response.data.currentAssetIndex,
            completedAssetIds: response.data.completedAssetIds,
          }
        : current,
    );
  }

  const summary =
    validationState.kind === "ready"
      ? validationState.link
      : sessionState
        ? {
            assets: sessionState.assets,
            remainingUses: 0,
            recipientName: "Recipient",
            imageDisplaySeconds: 10,
          }
        : null;

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">LinkVault</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">Secure content viewer</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="glass-panel rounded-full px-4 py-2 text-sm font-medium text-slate-700"
          >
            Home
          </button>
        </div>

        {validationState.kind === "loading" && <TokenValidationLoader />}

        {validationState.kind === "mobile" && (
          <MobileBlockedCard
            message={validationState.message}
            replacementKind={validationState.replacementKind}
            replacementUrl={validationState.replacementUrl}
          />
        )}

        {validationState.kind === "ready" && !sessionState && (
          <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="glass-panel soft-ring rounded-[32px] p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Validated for desktop</p>
              <h2 className="mt-3 text-4xl font-semibold text-slate-950">
                Content ready for {validationState.link.recipientName}
              </h2>
              <p className="mt-4 leading-7 text-slate-600">
                Desktop par link validate hote hi content 5 seconds me automatically open ho jayega. Aap chahein to
                button tap karke abhi bhi turant open kar sakte hain.
              </p>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <InfoChip label="Assets" value={validationState.link.assets.length} />
                <InfoChip label="Remaining uses" value={validationState.link.remainingUses} />
                <InfoChip label="Image timer" value={`${validationState.link.imageDisplaySeconds}s`} />
              </div>
              <button
                type="button"
                onClick={triggerOpenContent}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    triggerOpenContent();
                  }
                }}
                className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-brand-600 px-6 py-4 text-base font-semibold text-white shadow-halo disabled:opacity-70"
                disabled={isOpeningContent}
              >
                <Sparkles className="h-5 w-5" />
                {isOpeningContent ? "Opening secure viewer..." : "Tap to open now"}
              </button>
              <p className="mt-3 text-sm font-semibold text-brand-700">
                Desktop auto-open runs after 5 seconds. Tap once if you want to start immediately.
              </p>
            </div>

            <div className="glass-panel soft-ring rounded-[32px] p-8">
              <div className="rounded-[28px] bg-gradient-to-br from-brand-700 via-brand-600 to-sky-400 p-6 text-white">
                <p className="text-sm uppercase tracking-[0.3em] text-white/80">Session rules</p>
                <div className="mt-6 space-y-4">
                  <RuleRow icon={Monitor} text="Mobile opens never consume the link." />
                  <RuleRow icon={ImageIcon} text="Images open only on explicit reveal and auto-close on a timer." />
                  <RuleRow icon={PlayCircle} text="Video and audio must run to completion with custom locked playback." />
                  <RuleRow icon={ShieldAlert} text="First Esc allows one resume. Second Esc expires the link." />
                </div>
              </div>
            </div>
          </section>
        )}

        {sessionState && summary && (
          <section className="grid gap-8 lg:grid-cols-[0.76fr_1.24fr]">
            <aside className="glass-panel soft-ring rounded-[32px] p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Secure progress</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">One asset at a time</h2>
              <div className="mt-6 space-y-3">
                {summary.assets.map((asset, index) => (
                  <div
                    key={asset.id}
                    className={`rounded-2xl px-4 py-4 ${
                      sessionState.completedAssetIds.includes(asset.id)
                        ? "bg-emerald-50 text-emerald-700"
                        : index === sessionState.currentAssetIndex
                          ? "bg-brand-600 text-white"
                          : "bg-white/70 text-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">
                        {index + 1}. {asset.type.toUpperCase()}
                      </span>
                      {sessionState.completedAssetIds.includes(asset.id) && <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <p className="mt-2 truncate text-sm opacity-90">{asset.originalName}</p>
                  </div>
                ))}
              </div>
            </aside>

            <div className="glass-panel soft-ring relative rounded-[32px] p-6">
              {warningOverlay && (
                <div className="mb-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-700">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5" />
                    <div>
                      <p className="font-semibold">{warningOverlay}</p>
                      <p className="mt-2 text-sm">
                        {resumeMode === "escape"
                          ? "Escape paused the viewer. You have one server-approved resume for this session."
                          : resumeAllowed
                            ? "Suspicious behavior was detected. Content stays hidden until you choose to resume."
                            : "This secure session is no longer resumable from the current state."}
                      </p>
                      {resumeAllowed && (
                        <button
                          type="button"
                          onClick={() => void resumeViewing()}
                          data-allow-secure-action="true"
                          disabled={isResuming}
                          className="mt-4 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                        >
                          {isResuming
                            ? "Resuming secure viewing..."
                            : resumeMode === "escape"
                              ? "Use one-time resume"
                              : "Resume secure viewing"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {contentHidden || !currentAsset ? (
                <div className="flex min-h-[520px] items-center justify-center rounded-[28px] bg-slate-950 px-6 text-center text-slate-100">
                  <div className="max-w-lg">
                    <ShieldAlert className="mx-auto h-12 w-12 text-sky-300" />
                    <h3 className="mt-4 text-2xl font-semibold">Content is currently hidden</h3>
                    <p className="mt-4 leading-7 text-slate-300">
                      The viewer is locked after a secure-state change. Resume only if you are ready to continue under
                      the session rules.
                    </p>
                  </div>
                </div>
              ) : (
                <AssetStage
                  asset={currentAsset}
                  imageDisplaySeconds={summary.imageDisplaySeconds ?? 10}
                  src={assetUrl(currentAsset.id)}
                  onOpened={() => markAssetProgress(currentAsset.id, "opened")}
                  onCompleted={() => markAssetProgress(currentAsset.id, "completed")}
                  onProgress={(elapsedSeconds, durationSeconds) =>
                    reportSessionProgress(currentAsset.id, elapsedSeconds, durationSeconds)
                  }
                  onPauseAttempt={() => {
                    void reportSuspicious("pause-attempt", "Not allowed");
                  }}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function TokenValidationLoader() {
  return (
    <section className="glass-panel soft-ring mx-auto max-w-3xl overflow-hidden rounded-[36px] border border-white/70 bg-gradient-to-br from-white via-sky-50 to-brand-100 p-8 text-center md:p-10">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Secure handshake</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-950 md:text-4xl">Validating secure token</h2>
      <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">
        Preparing encrypted desktop access, integrity checks, and secure playback constraints.
      </p>

      <div className="relative mt-10 flex justify-center">
        <motion.div
          className="absolute h-40 w-40 rounded-full bg-brand-300/30 blur-3xl"
          animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: 2.1, repeat: Infinity }}
        />
        <div className="relative flex h-44 w-44 items-center justify-center">
          <motion.div
            className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#38bdf8,#4f46e5,#14b8a6,#38bdf8)] opacity-80"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 2.4, ease: "linear", repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-3 rounded-full bg-white/85 backdrop-blur"
            animate={{ scale: [1, 0.96, 1] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-[26%] flex items-center justify-center rounded-full bg-slate-950 text-sky-200 shadow-2xl"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 1.7, repeat: Infinity }}
          >
            <ShieldAlert className="h-10 w-10" />
          </motion.div>
          <motion.span
            className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-sky-300"
            animate={{ rotate: [0, 360] }}
            style={{ transformOrigin: "84px 0px" }}
            transition={{ duration: 1.9, ease: "linear", repeat: Infinity }}
          />
          <motion.span
            className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-brand-400"
            animate={{ rotate: [360, 0] }}
            style={{ transformOrigin: "-84px 0px" }}
            transition={{ duration: 2.4, ease: "linear", repeat: Infinity }}
          />
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-xl grid-cols-10 gap-2">
        {Array.from({ length: 20 }).map((_, index) => (
          <motion.span
            key={index}
            className="h-1.5 rounded-full bg-gradient-to-r from-brand-500 to-sky-400"
            animate={{ opacity: [0.25, 1, 0.25], scaleX: [0.8, 1.15, 0.8] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.05 }}
          />
        ))}
      </div>
    </section>
  );
}

function MobileBlockedCard({
  message,
  replacementKind,
  replacementUrl,
}: {
  message: string;
  replacementKind: PublicMobilePayload["replacementKind"];
  replacementUrl?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copyReplacementUrl() {
    if (!replacementUrl) {
      return;
    }
    void navigator.clipboard.writeText(replacementUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="glass-panel soft-ring mx-auto max-w-3xl rounded-[36px] bg-gradient-to-br from-brand-100 via-white to-sky-50 p-6 text-center md:p-10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-600 text-white shadow-halo">
        <Monitor className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-3xl font-semibold text-slate-950 md:text-4xl">Desktop access required</h2>
      <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-700">{message}</p>
      <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
        <div className="rounded-2xl bg-white/80 p-4 text-sm text-slate-700">
          Current link expired after mobile detection. Open on desktop browser only.
        </div>
        <div className="rounded-2xl bg-white/80 p-4 text-sm text-slate-700">
          If a replacement link is opened again on mobile, it expires permanently.
        </div>
      </div>
      {replacementKind === "issued" && replacementUrl && (
        <div className="mt-6 rounded-3xl bg-slate-950 p-5 text-left text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Replacement link issued</p>
          <p className="mt-3 break-all text-sm text-slate-200">{replacementUrl}</p>
          <button
            type="button"
            onClick={copyReplacementUrl}
            className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
          >
            {copied ? "Copied" : "Copy new desktop link"}
          </button>
        </div>
      )}
      {replacementKind === "permanent-expired" && (
        <p className="mx-auto mt-6 max-w-2xl rounded-2xl bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          No new replacement link is available. This access path is permanently expired.
        </p>
      )}
    </section>
  );
}

function CenteredCard({
  title,
  body,
  tone = "default",
  footer,
}: {
  title: string;
  body: string;
  tone?: "default" | "info" | "danger";
  footer?: string;
}) {
  const toneStyles =
    tone === "danger"
      ? "from-rose-100 via-white to-rose-50"
      : tone === "info"
        ? "from-brand-100 via-white to-sky-50"
        : "from-white via-brand-50 to-white";

  return (
    <section className={`glass-panel soft-ring mx-auto max-w-3xl rounded-[36px] bg-gradient-to-br ${toneStyles} p-8 text-center`}>
      <h2 className="text-4xl font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-4 max-w-2xl leading-8 text-slate-600">{body}</p>
      {footer && <p className="mx-auto mt-6 max-w-2xl rounded-2xl bg-slate-950 px-5 py-4 text-sm leading-7 text-slate-200">{footer}</p>}
    </section>
  );
}

function InfoChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-white via-brand-50 to-brand-100 p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function RuleRow({ icon: Icon, text }: { icon: typeof Monitor; text: string }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
        <Icon className="h-5 w-5" />
      </div>
      <p className="leading-7 text-white/90">{text}</p>
    </div>
  );
}

function AssetStage({
  asset,
  imageDisplaySeconds,
  src,
  onOpened,
  onCompleted,
  onProgress,
  onPauseAttempt,
}: {
  asset: SecureAsset;
  imageDisplaySeconds: number;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onProgress: (elapsedSeconds: number, durationSeconds?: number | null) => void | Promise<void>;
  onPauseAttempt: () => void;
}) {
  if (asset.type === "image") {
    return (
      <SecureImageStage
        asset={asset}
        src={src}
        imageDisplaySeconds={imageDisplaySeconds}
        onOpened={onOpened}
        onCompleted={onCompleted}
        onProgress={onProgress}
      />
    );
  }

  if (asset.type === "video") {
    return (
      <SecureVideoStage
        asset={asset}
        src={src}
        onOpened={onOpened}
        onCompleted={onCompleted}
        onProgress={onProgress}
        onPauseAttempt={onPauseAttempt}
      />
    );
  }

  return (
    <SecureAudioStage
      asset={asset}
      src={src}
      onOpened={onOpened}
      onCompleted={onCompleted}
      onProgress={onProgress}
      onPauseAttempt={onPauseAttempt}
    />
  );
}

function SecureImageStage({
  asset,
  src,
  imageDisplaySeconds,
  onOpened,
  onCompleted,
  onProgress,
}: {
  asset: SecureAsset;
  src: string;
  imageDisplaySeconds: number;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onProgress: (elapsedSeconds: number, durationSeconds?: number | null) => void | Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(imageDisplaySeconds);
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) {
      return;
    }

    openedRef.current = true;
    setSecondsLeft(imageDisplaySeconds);
    setRevealed(true);
    void onOpened();
    void onProgress(0, imageDisplaySeconds);
  }, [imageDisplaySeconds, onOpened, onProgress]);

  useEffect(() => {
    if (!revealed || !canvasRef.current) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0, image.width, image.height);
    };
    image.src = src;
  }, [revealed, src]);

  useEffect(() => {
    if (!revealed) {
      return;
    }

    const interval = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          void onProgress(imageDisplaySeconds, imageDisplaySeconds);
          void onCompleted();
          setRevealed(false);
          return 0;
        }
        const nextValue = current - 1;
        void onProgress(imageDisplaySeconds - nextValue, imageDisplaySeconds);
        return nextValue;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [imageDisplaySeconds, onCompleted, onProgress, revealed]);

  if (!revealed) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-[28px] bg-slate-950 px-6 text-center text-slate-100">
        <div className="max-w-md">
          <ImageIcon className="mx-auto h-12 w-12 text-sky-300" />
          <h3 className="mt-4 text-2xl font-semibold">Opening secure image</h3>
          <p className="mt-4 leading-7 text-slate-300">
            Preparing protected canvas content.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute right-4 top-4 z-10 rounded-full bg-slate-950/75 px-4 py-2 text-sm font-semibold text-white">
        {secondsLeft}s remaining
      </div>
      <div className="flex min-h-[520px] items-center justify-center rounded-[28px] bg-slate-950 p-4">
        <canvas ref={canvasRef} onContextMenu={(event) => event.preventDefault()} className="max-h-[480px] max-w-full rounded-2xl bg-black/40 shadow-2xl" />
      </div>
    </div>
  );
}

function SecureVideoStage({
  asset,
  src,
  onOpened,
  onCompleted,
  onProgress,
  onPauseAttempt,
}: {
  asset: SecureAsset;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onProgress: (elapsedSeconds: number, durationSeconds?: number | null) => void | Promise<void>;
  onPauseAttempt: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastTimeRef = useRef(0);
  const openedRef = useRef(false);
  const reportedSecondRef = useRef(-1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    void video.play().catch(() => undefined);
  }, []);

  const reportCurrentProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor(video.currentTime));
    if (reportedSecondRef.current === elapsedSeconds) {
      return;
    }

    reportedSecondRef.current = elapsedSeconds;
    void onProgress(
      elapsedSeconds,
      Number.isFinite(video.duration) ? Math.max(0, video.duration) : undefined,
    );
  }, [onProgress]);

  return (
    <div className="rounded-[28px] bg-slate-950 p-4">
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-100">
        <span>{asset.originalName}</span>
        <span>Pause and seek are disabled</span>
      </div>
      <video
        ref={videoRef}
        src={src}
        autoPlay
        controls={false}
        disablePictureInPicture
        playsInline
        controlsList="nodownload noplaybackrate nofullscreen"
        onContextMenu={(event) => event.preventDefault()}
        onPlay={() => {
          if (!openedRef.current) {
            openedRef.current = true;
            void onOpened();
          }
          reportCurrentProgress();
        }}
        onLoadedMetadata={() => {
          reportedSecondRef.current = -1;
          reportCurrentProgress();
        }}
        onPause={() => {
          const video = videoRef.current;
          if (!video || video.ended) {
            return;
          }
          onPauseAttempt();
          void video.play().catch(() => undefined);
        }}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video || video.seeking) {
            return;
          }
          lastTimeRef.current = video.currentTime;
          reportCurrentProgress();
        }}
        onSeeking={() => {
          const video = videoRef.current;
          if (!video) {
            return;
          }
          if (Math.abs(video.currentTime - lastTimeRef.current) > 0.35) {
            video.currentTime = lastTimeRef.current;
          }
        }}
        onEnded={() => {
          const video = videoRef.current;
          void onProgress(
            Math.max(0, Math.floor(video?.duration ?? video?.currentTime ?? 0)),
            Number.isFinite(video?.duration) ? Math.max(0, video?.duration ?? 0) : undefined,
          );
          void onCompleted();
        }}
        className="max-h-[520px] w-full rounded-[24px] bg-black"
      />
    </div>
  );
}

function SecureAudioStage({
  asset,
  src,
  onOpened,
  onCompleted,
  onProgress,
  onPauseAttempt,
}: {
  asset: SecureAsset;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onProgress: (elapsedSeconds: number, durationSeconds?: number | null) => void | Promise<void>;
  onPauseAttempt: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRef = useRef(false);
  const reportedSecondRef = useRef(-1);
  const [hasStarted, setHasStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const reportCurrentProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor(audio.currentTime));
    if (reportedSecondRef.current === elapsedSeconds) {
      return;
    }

    reportedSecondRef.current = elapsedSeconds;
    void onProgress(
      elapsedSeconds,
      Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : undefined,
    );
  }, [onProgress]);

  const startAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || hasStarted || isStarting) {
      return;
    }

    setStartError(null);
    setIsStarting(true);
    void audio
      .play()
      .then(() => {
        setHasStarted(true);
        if (!openedRef.current) {
          openedRef.current = true;
          void onOpened();
        }
      })
      .catch(() => {
        setStartError("Unable to start playback. Check audio output permission and try again.");
      })
      .finally(() => {
        setIsStarting(false);
      });
  }, [hasStarted, isStarting, onOpened]);

  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-[28px] bg-gradient-to-br from-slate-950 via-brand-950 to-brand-900 p-8 text-white">
      <audio
        ref={audioRef}
        src={src}
        controls={false}
        preload="metadata"
        onPlay={() => {
          setHasStarted(true);
          if (!openedRef.current) {
            openedRef.current = true;
            void onOpened();
          }
          reportCurrentProgress();
        }}
        onLoadedMetadata={() => {
          reportedSecondRef.current = -1;
          reportCurrentProgress();
        }}
        onPause={() => {
          const audio = audioRef.current;
          if (!audio || audio.ended) {
            return;
          }
          onPauseAttempt();
          void audio.play().catch(() => undefined);
        }}
        onTimeUpdate={() => {
          reportCurrentProgress();
        }}
        onEnded={() => {
          const audio = audioRef.current;
          void onProgress(
            Math.max(0, Math.floor(audio?.duration ?? audio?.currentTime ?? 0)),
            Number.isFinite(audio?.duration) ? Math.max(0, audio?.duration ?? 0) : undefined,
          );
          void onCompleted();
        }}
      />
      <div className="text-center">
        <Headphones className="mx-auto h-14 w-14 text-sky-200" />
        <h3 className="mt-5 text-3xl font-semibold">{asset.originalName}</h3>
        {!hasStarted ? (
          <div className="mt-4">
            <p className="mx-auto max-w-md leading-7 text-slate-200">
              Attach headphones before you start. Once playback begins, pause and stop are blocked until completion.
            </p>
            <button
              type="button"
              onClick={startAudio}
              disabled={isStarting}
              data-allow-secure-action="true"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 disabled:opacity-70"
            >
              <PlayCircle className="h-4 w-4" />
              {isStarting ? "Starting audio..." : "Play audio now"}
            </button>
            {startError && <p className="mt-3 text-sm font-semibold text-rose-200">{startError}</p>}
          </div>
        ) : (
          <p className="mt-3 max-w-md leading-7 text-slate-200">
            Audio is playing. Pause and stop interactions are ignored until completion.
          </p>
        )}
        <div className="mt-8 flex justify-center gap-2">
          {Array.from({ length: 18 }).map((_, index) => (
            <motion.span
              key={index}
              animate={{ height: [18, 54, 24] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.04 }}
              className="w-2 rounded-full bg-sky-300"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function useViewerSecurity({
  enabled,
  fullscreenRequired,
  onSuspicious,
}: {
  enabled: boolean;
  fullscreenRequired: boolean;
  onSuspicious: (eventName: string) => void | Promise<void>;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let locked = false;
    const trigger = (eventName: string) => {
      if (locked) {
        return;
      }
      locked = true;
      void Promise.resolve(onSuspicious(eventName)).finally(() => {
        locked = false;
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "PrintScreen") {
        trigger("printscreen");
      }
      if (event.ctrlKey && event.shiftKey && key === "i") {
        event.preventDefault();
        trigger("devtools-shortcut");
      }
      if (key === "f12") {
        event.preventDefault();
        trigger("devtools-shortcut");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        trigger("visibility-hidden");
      }
    };

    const onBlur = () => trigger("window-blur");
    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      trigger("copy-attempt");
    };
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      trigger("context-menu");
    };
    const onFullscreen = () => {
      if (fullscreenRequired && !document.fullscreenElement) {
        trigger("fullscreen-exit");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    window.addEventListener("copy", onCopy);
    window.addEventListener("contextmenu", onContext);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("contextmenu", onContext);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [enabled, fullscreenRequired, onSuspicious]);
}

async function requestFullscreenBestEffort() {
  const element = document.documentElement;
  if (!element.requestFullscreen) {
    return false;
  }

  try {
    await element.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
