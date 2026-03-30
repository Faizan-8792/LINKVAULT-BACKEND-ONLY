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
import type { PublicLinkPayload, SecureAsset } from "@secure-viewer/shared";
import { api } from "../lib/api";
import { getViewerDeviceContext } from "../lib/deviceContext";

type ValidationState =
  | { kind: "loading" }
  | { kind: "mobile"; message: string }
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

export function ViewerPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [validationState, setValidationState] = useState<ValidationState>({ kind: "loading" });
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [warningOverlay, setWarningOverlay] = useState<string | null>(null);
  const [contentHidden, setContentHidden] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isOpeningContent, setIsOpeningContent] = useState(false);
  const [isHoverCountdownActive, setIsHoverCountdownActive] = useState(false);
  const completedFinalization = useRef(false);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const sessionStateRef = useRef<SessionState | null>(null);
  const isOpeningContentRef = useRef(false);

  const cancelHoverOpenCountdown = useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    setIsHoverCountdownActive(false);
  }, []);

  const reportSuspicious = useCallback(
    async (eventName: string, customMessage?: string) => {
      if (!sessionState) {
        return;
      }

      setContentHidden(true);
      try {
        const response = await api.post("/api/public/report-suspicious", {
          sessionId: sessionState.sessionId,
          event: eventName,
        });

        if (response.data.sessionEnded) {
          setSessionState(null);
          setWarningOverlay(response.data.message);
          setContentHidden(false);
          return;
        }

        if (response.data.destroyed) {
          redirectToDeadLinkPage();
          return;
        }

        setSessionState((current) =>
          current ? { ...current, warningCount: response.data.warningCount } : current,
        );
        setWarningOverlay(customMessage ?? response.data.message);
      } catch {
        redirectToDeadLinkPage();
      }
    },
    [sessionState],
  );

  useEffect(() => {
    let cancelled = false;

    async function validate() {
      try {
        const response = await api.post("/api/public/validate-link", {
          token,
          deviceContext: getViewerDeviceContext(),
        });
        if (cancelled) {
          return;
        }

        if (response.data.mode === "mobile") {
          setValidationState({
            kind: "mobile",
            message: response.data.message,
          });
          return;
        }

        setValidationState({ kind: "ready", link: response.data.link });
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

  useEffect(() => cancelHoverOpenCountdown, [cancelHoverOpenCountdown]);

  useViewerSecurity({
    enabled: Boolean(sessionState),
    fullscreenRequired: Boolean(sessionState?.fullscreenAccepted),
    onSuspicious: (eventName) => reportSuspicious(eventName),
  });

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

      setSessionState({ ...response.data, fullscreenAccepted });
      setWarningOverlay(null);
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

    cancelHoverOpenCountdown();
    isOpeningContentRef.current = true;
    setIsOpeningContent(true);
    void openContent().finally(() => {
      isOpeningContentRef.current = false;
      setIsOpeningContent(false);
    });
  }, [cancelHoverOpenCountdown, openContent]);

  const startHoverOpenCountdown = useCallback(() => {
    if (isOpeningContentRef.current || sessionStateRef.current || hoverOpenTimerRef.current !== null) {
      return;
    }

    setIsHoverCountdownActive(true);
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      setIsHoverCountdownActive(false);
      triggerOpenContent();
    }, 2000);
  }, [triggerOpenContent]);

  async function markAssetProgress(assetId: string, event: "opened" | "completed") {
    if (!sessionState) {
      return;
    }

    const response = await api.post("/api/public/asset-progress", {
      sessionId: sessionState.sessionId,
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
          <MobileBlockedCard message={validationState.message} />
        )}

        {validationState.kind === "ready" && !sessionState && (
          <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="glass-panel soft-ring rounded-[32px] p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Validated for desktop</p>
              <h2 className="mt-3 text-4xl font-semibold text-slate-950">
                Content ready for {validationState.link.recipientName}
              </h2>
              <p className="mt-4 leading-7 text-slate-600">
                Hover on the content button for 2 seconds to open in secure viewer mode.
              </p>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <InfoChip label="Assets" value={validationState.link.assets.length} />
                <InfoChip label="Remaining uses" value={validationState.link.remainingUses} />
                <InfoChip label="Image timer" value={`${validationState.link.imageDisplaySeconds}s`} />
              </div>
              <motion.button
                type="button"
                onMouseEnter={startHoverOpenCountdown}
                onMouseLeave={cancelHoverOpenCountdown}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    triggerOpenContent();
                  }
                }}
                whileHover={{ scale: 1.02 }}
                animate={{ scale: [1, 1.03, 1], y: [0, -2, 0] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-brand-600 px-6 py-4 text-base font-semibold text-white shadow-halo"
              >
                <Sparkles className="h-5 w-5" />
                {isHoverCountdownActive ? "Hovering... opening soon" : "Hover for 2s to open content"}
              </motion.button>
              <p className="mt-3 text-sm font-semibold text-brand-700">
                {isHoverCountdownActive ? "Keep hovering to begin secure viewing" : "Hover and hold for 2 seconds to begin secure viewing"}
              </p>
            </div>

            <div className="glass-panel soft-ring rounded-[32px] p-8">
              <div className="rounded-[28px] bg-gradient-to-br from-brand-700 via-brand-600 to-sky-400 p-6 text-white">
                <p className="text-sm uppercase tracking-[0.3em] text-white/80">Session rules</p>
                <div className="mt-6 space-y-4">
                  <RuleRow icon={Monitor} text="Mobile opens never consume the link." />
                  <RuleRow icon={ImageIcon} text="Images open only on explicit reveal and auto-close on a timer." />
                  <RuleRow icon={PlayCircle} text="Video and audio must run to completion with custom locked playback." />
                  <RuleRow icon={ShieldAlert} text="Suspicious events warn once, then destroy the session." />
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
                        Suspicious behavior was detected. Content stays hidden until you choose to resume.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setWarningOverlay(null);
                          setContentHidden(false);
                        }}
                        data-allow-secure-action="true"
                        className="mt-4 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Resume secure viewing
                      </button>
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
    <section className="glass-panel soft-ring mx-auto max-w-3xl rounded-[36px] p-8 text-center md:p-10">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Secure handshake</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-950 md:text-4xl">Validating secure token</h2>
      <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">
        Please wait while we verify device rules, token integrity, and secure session eligibility.
      </p>
      <div className="mt-8 flex justify-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <motion.span
            className="absolute h-28 w-28 rounded-full border-4 border-brand-200"
            animate={{ scale: [0.9, 1.05, 0.9], opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <motion.span
            className="absolute h-20 w-20 rounded-full border-4 border-brand-400"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
          <ShieldAlert className="h-9 w-9 text-brand-700" />
        </div>
      </div>
      <div className="mt-8 flex items-end justify-center gap-2">
        {Array.from({ length: 16 }).map((_, index) => (
          <motion.span
            key={index}
            className="w-1.5 rounded-full bg-brand-500"
            animate={{ height: [10, 24, 14] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.06 }}
          />
        ))}
      </div>
    </section>
  );
}

function MobileBlockedCard({ message }: { message: string }) {
  return (
    <section className="glass-panel soft-ring mx-auto max-w-3xl rounded-[36px] bg-gradient-to-br from-brand-100 via-white to-sky-50 p-6 text-center md:p-10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-600 text-white shadow-halo">
        <Monitor className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-3xl font-semibold text-slate-950 md:text-4xl">Desktop access required</h2>
      <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-700">{message}</p>
      <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
        <div className="rounded-2xl bg-white/80 p-4 text-sm text-slate-700">Open this link on desktop browser only.</div>
        <div className="rounded-2xl bg-white/80 p-4 text-sm text-slate-700">Avoid tab switching and suspicious interactions.</div>
      </div>
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
  onPauseAttempt,
}: {
  asset: SecureAsset;
  imageDisplaySeconds: number;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
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
      />
    );
  }

  if (asset.type === "video") {
    return <SecureVideoStage asset={asset} src={src} onOpened={onOpened} onCompleted={onCompleted} onPauseAttempt={onPauseAttempt} />;
  }

  return <SecureAudioStage asset={asset} src={src} onOpened={onOpened} onCompleted={onCompleted} onPauseAttempt={onPauseAttempt} />;
}

function SecureImageStage({
  asset,
  src,
  imageDisplaySeconds,
  onOpened,
  onCompleted,
}: {
  asset: SecureAsset;
  src: string;
  imageDisplaySeconds: number;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
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
  }, [imageDisplaySeconds, onOpened]);

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
          void onCompleted();
          setRevealed(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [onCompleted, revealed]);

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
  onPauseAttempt,
}: {
  asset: SecureAsset;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onPauseAttempt: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastTimeRef = useRef(0);
  const openedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    void video.play().catch(() => undefined);
  }, []);

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
  onPauseAttempt,
}: {
  asset: SecureAsset;
  src: string;
  onOpened: () => void | Promise<void>;
  onCompleted: () => void | Promise<void>;
  onPauseAttempt: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    void audio.play().catch(() => undefined);
  }, []);

  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-[28px] bg-gradient-to-br from-slate-950 via-brand-950 to-brand-900 p-8 text-white">
      <audio
        ref={audioRef}
        src={src}
        autoPlay
        controls={false}
        onPlay={() => {
          if (!openedRef.current) {
            openedRef.current = true;
            void onOpened();
          }
        }}
        onPause={() => {
          const audio = audioRef.current;
          if (!audio || audio.ended) {
            return;
          }
          onPauseAttempt();
          void audio.play().catch(() => undefined);
        }}
        onEnded={() => {
          void onCompleted();
        }}
      />
      <div className="text-center">
        <Headphones className="mx-auto h-14 w-14 text-sky-200" />
        <h3 className="mt-5 text-3xl font-semibold">{asset.originalName}</h3>
        <p className="mt-3 max-w-md leading-7 text-slate-200">
          Audio playback has started automatically. Stop and pause interactions are ignored until completion.
        </p>
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
