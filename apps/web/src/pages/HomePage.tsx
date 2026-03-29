import { motion } from "framer-motion";
import { EyeOff, Shield, TimerReset, Waypoints } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Tokenized private delivery",
    description: "Every share link is unique, tracked, and designed to collapse after secure viewing rules are met.",
  },
  {
    icon: TimerReset,
    title: "Session-based expiry",
    description: "Desktop-only sessions, timed image reveals, and completion-aware playback rules create a high-friction secure flow.",
  },
  {
    icon: EyeOff,
    title: "Deterrence-first viewer",
    description: "Blur, visibility, shortcut, and context-menu reactions discourage casual capture and suspicious behavior.",
  },
  {
    icon: Waypoints,
    title: "Admin approval workflow",
    description: "Hidden admin entry, JWT auth, approval gating, bundle uploads, and live link status tracking in one place.",
  },
];

export function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 mesh-overlay opacity-40" />
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="sticky top-4 z-20">
          <div className="rounded-[24px] bg-gradient-to-r from-brand-900 via-brand-800 to-brand-700 p-2.5 shadow-halo">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/5 px-3 py-2">
              <img src="/linkvault-logo.svg" alt="LinkVault" className="h-10 w-auto md:h-11" />
              <nav className="flex flex-wrap items-center gap-2">
                <a
                  href="#overview"
                  className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  How it works
                </a>
                <a
                  href="#security"
                  className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Security
                </a>
                <a
                  href="#viewer-flow"
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-800 transition hover:bg-brand-50"
                >
                  Viewer flow
                </a>
              </nav>
            </div>
          </div>
        </header>

        <section id="overview" className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.2fr_0.8fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-7"
          >
            <div className="glass-panel soft-ring inline-flex rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-brand-700">
              Blue-white secure delivery experience
            </div>
            <div className="space-y-5">
              <h2 className="max-w-3xl text-5xl font-semibold leading-tight text-slate-950">
                A self-destructive browser viewer that feels reactive, guarded, and intentional.
              </h2>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                Upload image, video, and audio bundles. Generate secure links. Restrict playback to desktop.
                Track device access. Warn on suspicious behavior. Destroy sessions and schedule cleanup when the
                experience is complete.
              </p>
            </div>
          </motion.div>

          <motion.div
            id="viewer-flow"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.1 }}
            className="glass-panel soft-ring relative rounded-[32px] border border-white/60 p-6"
          >
            <div className="rounded-[28px] bg-gradient-to-br from-brand-700 via-brand-600 to-sky-400 p-6 text-white">
              <p className="text-sm uppercase tracking-[0.3em] text-white/80">Viewer Flow</p>
              <div className="mt-6 space-y-4">
                {[
                  "Validate secure token and detect device",
                  "Desktop session starts and locks usage",
                  "Reveal assets one by one without previews",
                  "Destroy or expire link after secure completion",
                ].map((item, index) => (
                  <div key={item} className="flex items-start gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
                      {index + 1}
                    </div>
                    <p className="leading-7 text-white/90">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        <section id="security" className="grid gap-5 pb-16 md:grid-cols-2 xl:grid-cols-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="glass-panel soft-ring rounded-3xl p-6"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{feature.description}</p>
              </motion.article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
