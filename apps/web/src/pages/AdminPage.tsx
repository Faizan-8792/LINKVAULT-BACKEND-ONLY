import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  LogOut,
  MoveDown,
  MoveUp,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { defaultMobileMessage, limitationCopy } from "@secure-viewer/shared";
import { api, getApiErrorMessage } from "../lib/api";
import { useAuth } from "../state/auth";

type PendingUser = {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
};

type LinkItem = {
  id: string;
  recipientName: string;
  status: string;
  maxUses: number;
  usesConsumed: number;
  mobileOpenCount: number;
  desktopOpenCount: number;
  createdAt: string;
  expiredAt: string | null;
  assetCount: number;
};

type UploadedAsset = {
  id: string;
  type: "image" | "video" | "audio";
  originalName: string;
  mimeType: string;
  durationSeconds: number | null;
  order: number;
  storageKey: string;
};

type AuthMode = "login" | "signup";

export function AdminPage() {
  const { token, user, setSession, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      return;
    }

    const inactivityMs = 15 * 60 * 1000;
    let timeoutId = 0;
    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "scroll", "touchstart"];

    const resetInactivityTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        logout();
        navigate("/admin", { replace: true });
      }, inactivityMs);
    };

    events.forEach((eventName) => window.addEventListener(eventName, resetInactivityTimer, { passive: true }));
    resetInactivityTimer();

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetInactivityTimer));
    };
  }, [logout, navigate, token]);

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Hidden admin panel</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">Secure control center</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/" className="glass-panel rounded-full px-4 py-2 text-sm font-medium text-slate-700">
              <span className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to site
              </span>
            </Link>
            {token && (
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate("/");
                }}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Logout
                </span>
              </button>
            )}
          </div>
        </div>

        {!token || !user ? (
          <AuthCard onAuthSuccess={setSession} />
        ) : user.status !== "approved" ? (
          <PendingApprovalCard userName={user.name} />
        ) : (
          <Dashboard userName={user.name} />
        )}
      </div>
    </main>
  );
}

function AuthCard({ onAuthSuccess }: { onAuthSuccess: (token: string, user: any) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };
      const response = await api.post(endpoint, payload);
      return response.data as { token: string; user: any };
    },
    onSuccess(data) {
      onAuthSuccess(data.token, data.user);
    },
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="glass-panel soft-ring rounded-[32px] p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Secure login access</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-950">
          {mode === "login" ? "Return to the control center" : "Request admin access"}
        </h2>
        <p className="mt-4 leading-7 text-slate-600">
          The first signup becomes the first approved admin automatically. Every later signup stays pending until an
          existing admin approves it.
        </p>
        <div className="mt-6 flex rounded-full bg-white/70 p-1 shadow-inner">
          {(["login", "signup"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setMode(candidate);
                setLocalError(null);
              }}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                mode === candidate ? "bg-brand-600 text-white shadow-halo" : "text-slate-600"
              }`}
            >
              {candidate === "login" ? "Login" : "Signup"}
            </button>
          ))}
        </div>
        <form
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError(null);
            if (mode === "signup" && form.password !== form.confirmPassword) {
              setLocalError("Password and confirm password must match.");
              return;
            }
            mutation.mutate();
          }}
        >
          {mode === "signup" && (
            <Field
              label="Full name"
              value={form.name}
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              placeholder="Enter full name"
            />
          )}
          <Field
            label="Email"
            value={form.email}
            onChange={(value) => setForm((current) => ({ ...current, email: value }))}
            placeholder="admin@example.com"
            type="email"
          />
          <PasswordField
            label="Password"
            value={form.password}
            onChange={(value) => setForm((current) => ({ ...current, password: value }))}
            placeholder="Minimum 8 characters"
            showPassword={showPassword}
            onToggleVisibility={() => setShowPassword((current) => !current)}
          />
          {mode === "signup" && (
            <PasswordField
              label="Confirm password"
              value={form.confirmPassword}
              onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))}
              placeholder="Re-enter password"
              showPassword={showConfirmPassword}
              onToggleVisibility={() => setShowConfirmPassword((current) => !current)}
            />
          )}
          {localError && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{localError}</p>}
          {mutation.isError && (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {getApiErrorMessage(mutation.error, "Authentication failed")}
            </p>
          )}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-halo disabled:opacity-70"
          >
            {mutation.isPending ? "Please wait..." : mode === "login" ? "Login" : "Create request"}
          </button>
        </form>
      </section>

      <section className="glass-panel soft-ring rounded-[32px] border border-white/70 p-8">
        <div className="rounded-[28px] bg-gradient-to-br from-white via-brand-50 to-brand-100 p-6">
          <div className="flex items-center gap-3 text-brand-700">
            <ShieldCheck className="h-6 w-6" />
            <p className="font-semibold uppercase tracking-[0.3em]">Security posture</p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              "JWT-based authentication for admin APIs",
              "Single active session with browser fingerprint lock",
              "Pending-admin approvals after the first bootstrap user",
              "Upload bundles with per-link secure settings",
              "Tracked desktop/mobile opening behavior",
            ].map((item) => (
              <div key={item} className="rounded-2xl bg-white/70 p-4 text-sm leading-7 text-slate-600 shadow-sm">
                {item}
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-slate-950 px-5 py-4 text-sm leading-7 text-slate-200">
            {limitationCopy}
          </div>
        </div>
      </section>
    </div>
  );
}

function PendingApprovalCard({ userName }: { userName: string }) {
  return (
    <section className="glass-panel soft-ring max-w-3xl rounded-[32px] p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Approval pending</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-950">Hi {userName}, your admin access request is waiting for approval.</h2>
      <p className="mt-4 max-w-2xl leading-7 text-slate-600">
        Once an approved admin confirms your account, this hidden panel will unlock uploads, link generation, and live
        tracking features.
      </p>
    </section>
  );
}

function Dashboard({ userName }: { userName: string }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [recipientName, setRecipientName] = useState("");
  const [mobileMessageTemplate, setMobileMessageTemplate] = useState(defaultMobileMessage);
  const [imageDisplaySeconds, setImageDisplaySeconds] = useState(10);
  const [maxUses, setMaxUses] = useState(1);
  const [autoDeleteDelaySeconds, setAutoDeleteDelaySeconds] = useState(300);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const pendingUsersQuery = useQuery({
    queryKey: ["pending-users"],
    queryFn: async () => {
      const response = await api.get<{ users: PendingUser[] }>("/api/admin/pending-users");
      return response.data.users;
    },
  });

  const linksQuery = useQuery({
    queryKey: ["links"],
    queryFn: async () => {
      const response = await api.get<{ links: LinkItem[] }>("/api/admin/links");
      return response.data.links;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await api.post<{ assets: UploadedAsset[] }>("/api/admin/uploads", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.assets;
    },
    onSuccess(assets) {
      setUploadedAssets((current) =>
        applyDefaultAssetOrder([
          ...current,
          ...assets.map((asset, index) => ({ ...asset, order: current.length + index })),
        ]),
      );
      setFiles([]);
    },
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{ viewerUrl: string }>("/api/admin/links", {
        recipientName,
        mobileMessageTemplate,
        imageDisplaySeconds,
        maxUses,
        autoDeleteDelaySeconds,
        assets: uploadedAssets.map((asset, index) => ({ ...asset, order: index })),
      });
      return response.data.viewerUrl;
    },
    onSuccess(viewerUrl) {
      setGeneratedLink(viewerUrl);
      void linksQuery.refetch();
    },
  });

  const approveUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/api/admin/users/${userId}/approve`);
    },
    onSuccess() {
      void pendingUsersQuery.refetch();
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await api.delete(`/api/admin/links/${linkId}`);
    },
    onSuccess() {
      void linksQuery.refetch();
    },
  });

  const stats = useMemo(() => {
    const links = linksQuery.data ?? [];
    return {
      totalLinks: links.length,
      activeLinks: links.filter((link) => link.status === "active").length,
      expiredLinks: links.filter((link) => ["expired", "destroyed", "consumed"].includes(link.status)).length,
      mobileOpens: links.reduce((sum, link) => sum + link.mobileOpenCount, 0),
    };
  }, [linksQuery.data]);

  function applyDefaultAssetOrder(assets: UploadedAsset[]) {
    const typeRank: Record<UploadedAsset["type"], number> = {
      image: 0,
      audio: 1,
      video: 2,
    };

    return [...assets]
      .sort((left, right) => {
        const byType = typeRank[left.type] - typeRank[right.type];
        if (byType !== 0) {
          return byType;
        }
        return left.order - right.order;
      })
      .map((asset, order) => ({ ...asset, order }));
  }

  function moveAsset(index: number, direction: -1 | 1) {
    setUploadedAssets((current) => {
      const next = [...current];
      const target = next[index];
      const swapIndex = index + direction;
      if (!target || !next[swapIndex]) {
        return current;
      }
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next.map((asset, order) => ({ ...asset, order }));
    });
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <div className="glass-panel soft-ring rounded-[32px] p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-brand-700">Welcome back</p>
          <h2 className="mt-3 text-4xl font-semibold text-slate-950">{userName}'s secure operations dashboard</h2>
          <p className="mt-4 max-w-3xl leading-7 text-slate-600">
            Build secure content bundles, generate tokenized links, review pending admins, and monitor whether your
            recipient opened on mobile or desktop.
          </p>
          <p className="mt-2 text-sm font-medium text-brand-700">
            Session security: this admin login is locked to this browser fingerprint and auto-logs out after 15
            minutes of inactivity.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <StatCard label="Total links" value={stats.totalLinks} />
            <StatCard label="Active links" value={stats.activeLinks} />
            <StatCard label="Expired links" value={stats.expiredLinks} />
            <StatCard label="Mobile opens" value={stats.mobileOpens} />
          </div>
        </div>

        <div className="glass-panel soft-ring rounded-[32px] p-8">
          <div className="flex items-center gap-3 text-brand-700">
            <Users className="h-5 w-5" />
            <p className="font-semibold uppercase tracking-[0.3em]">Pending admin approvals</p>
          </div>
          <div className="mt-6 space-y-4">
            {(pendingUsersQuery.data ?? []).length === 0 ? (
              <div className="rounded-2xl bg-white/70 px-4 py-6 text-sm text-slate-500">No pending signup requests.</div>
            ) : (
              pendingUsersQuery.data?.map((candidate) => (
                <div key={candidate.id} className="rounded-2xl bg-white/70 p-4 shadow-sm">
                  <p className="font-semibold text-slate-900">{candidate.name}</p>
                  <p className="text-sm text-slate-500">{candidate.email}</p>
                  <button
                    type="button"
                    onClick={() => approveUserMutation.mutate(candidate.id)}
                    className="mt-4 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Approve
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="glass-panel soft-ring rounded-[32px] p-8">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-brand-700" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-700">Create secure bundle</p>
              <h3 className="text-2xl font-semibold text-slate-950">Upload assets and generate a protected link</h3>
            </div>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <Field label="Recipient name" value={recipientName} onChange={setRecipientName} placeholder="Recipient name" />
            <Field
              label="Image display seconds"
              value={String(imageDisplaySeconds)}
              onChange={(value) => setImageDisplaySeconds(Number(value) || 10)}
              type="number"
            />
            <Field
              label="Max uses"
              value={String(maxUses)}
              onChange={(value) => setMaxUses(Number(value) || 1)}
              type="number"
            />
            <Field
              label="Auto-delete seconds"
              value={String(autoDeleteDelaySeconds)}
              onChange={(value) => setAutoDeleteDelaySeconds(Number(value) || 300)}
              type="number"
            />
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Mobile message</span>
            <textarea
              value={mobileMessageTemplate}
              onChange={(event) => setMobileMessageTemplate(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-brand-100 bg-white/80 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-brand-400"
            />
          </label>

          <div className="mt-6 rounded-3xl border border-dashed border-brand-200 bg-brand-50/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-slate-900">Upload image, video, or audio files</p>
                <p className="text-sm text-slate-500">One link can include one file or a full ordered bundle.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                <Plus className="h-4 w-4" />
                Select files
                <input
                  hidden
                  multiple
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={(event) => {
                    const incomingFiles = Array.from(event.target.files ?? []);
                    if (!incomingFiles.length) {
                      return;
                    }

                    setFiles((current) => {
                      const merged = [...current];
                      for (const file of incomingFiles) {
                        const exists = merged.some(
                          (candidate) =>
                            candidate.name === file.name &&
                            candidate.size === file.size &&
                            candidate.lastModified === file.lastModified,
                        );
                        if (!exists) {
                          merged.push(file);
                        }
                      }
                      return merged;
                    });

                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {files.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                  <p>{files.length} file(s) ready for upload.</p>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-700"
                  >
                    Clear selection
                  </button>
                </div>
                <div className="max-h-44 space-y-2 overflow-auto pr-1 secure-scrollbar">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 text-sm"
                    >
                      <p className="truncate text-slate-700">
                        {index + 1}. {file.name}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((current) => current.filter((candidate) => candidate !== file))
                        }
                        className="rounded-full border border-brand-200 px-2 py-1 text-xs font-semibold text-brand-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={files.length === 0 || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              className="mt-5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploadMutation.isPending
                ? "Uploading..."
                : `Upload selected assets (${files.length})`}
            </button>
          </div>

          {uploadedAssets.length > 0 && (
            <div className="mt-6 space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-700">Bundle order</p>
              {uploadedAssets.map((asset, index) => (
                <div key={asset.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white/75 p-4 shadow-sm">
                  <div>
                    <p className="font-semibold text-slate-900">{asset.originalName}</p>
                    <p className="text-sm text-slate-500">
                      {asset.type} • {asset.mimeType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => moveAsset(index, -1)}
                      className="rounded-full border border-brand-200 p-2 text-brand-700"
                    >
                      <MoveUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAsset(index, 1)}
                      className="rounded-full border border-brand-200 p-2 text-brand-700"
                    >
                      <MoveDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={!recipientName || uploadedAssets.length === 0 || createLinkMutation.isPending}
            onClick={() => createLinkMutation.mutate()}
            className="mt-8 w-full rounded-2xl bg-brand-600 px-6 py-4 text-base font-semibold text-white shadow-halo disabled:opacity-60"
          >
            {createLinkMutation.isPending ? "Generating secure URL..." : "Generate secure URL"}
          </button>

          {generatedLink && (
            <div className="mt-6 rounded-3xl bg-slate-950 p-5 text-slate-50">
              <p className="text-sm uppercase tracking-[0.3em] text-sky-200">Secure URL ready</p>
              <p className="mt-3 break-all text-sm text-slate-200">{generatedLink}</p>
              <p className="mt-2 text-xs text-slate-300">
                This single URL contains {uploadedAssets.length} ordered asset(s) in one secure bundle.
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(generatedLink)}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
              >
                <Copy className="h-4 w-4" />
                Copy link
              </button>
            </div>
          )}
        </div>

        <div className="glass-panel soft-ring rounded-[32px] p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-700">Link status tracking</p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-950">Generated links</h3>
          <div className="mt-6 space-y-4">
            {(linksQuery.data ?? []).length === 0 ? (
              <div className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
                No secure links generated yet.
              </div>
            ) : (
              linksQuery.data?.map((link) => (
                <div key={link.id} className="rounded-2xl bg-white/75 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-900">{link.recipientName}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {link.assetCount} asset(s) | {link.usesConsumed}/{link.maxUses} uses
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={link.status} />
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Delete this secure link and all of its tracking data?")) {
                            deleteLinkMutation.mutate(link.id);
                          }
                        }}
                        disabled={deleteLinkMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs text-slate-500">
                    <div className="rounded-2xl bg-brand-50 p-3">
                      <p className="font-semibold text-brand-700">{link.mobileOpenCount}</p>
                      <p>Mobile</p>
                    </div>
                    <div className="rounded-2xl bg-brand-50 p-3">
                      <p className="font-semibold text-brand-700">{link.desktopOpenCount}</p>
                      <p>Desktop</p>
                    </div>
                    <div className="rounded-2xl bg-brand-50 p-3">
                      <p className="font-semibold text-brand-700">{new Date(link.createdAt).toLocaleDateString()}</p>
                      <p>Created</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showPassword: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-brand-100 bg-white/80 px-4 py-3 pr-12 text-slate-900 outline-none transition focus:border-brand-400"
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-700"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-brand-100 bg-white/80 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-400"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-white via-brand-50 to-brand-100 p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette =
    status === "active"
      ? "bg-emerald-50 text-emerald-600"
      : status === "destroyed"
        ? "bg-rose-50 text-rose-600"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${palette}`}>
      <Check className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}
