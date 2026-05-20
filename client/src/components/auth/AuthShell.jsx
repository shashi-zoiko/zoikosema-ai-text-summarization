import { motion } from 'framer-motion'
import { ShieldCheck, Sparkles } from 'lucide-react'
import Logo from '../ui/Logo'
import Badge from '../ui/Badge'
import { fadeUp, stagger } from '../../lib/motion'

const TRUST = [
  'SOC 2 Type II ready',
  'End-to-end encrypted',
  '99.99% uptime SLA',
  'GDPR compliant',
]

export default function AuthShell({ pillars, headline, sub, children }) {
  return (
    <div className="relative isolate flex min-h-screen overflow-hidden bg-[var(--c-bg)] text-[var(--c-fg)]">
      {/* ambient gradient + grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="grid-pattern absolute inset-0 opacity-50" />
        <div
          className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full opacity-50 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent), transparent)' }}
        />
        <div
          className="absolute -bottom-40 right-0 h-[520px] w-[520px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent-3), transparent)' }}
        />
      </div>

      <div className="relative grid w-full grid-cols-1 lg:grid-cols-[1.05fr_minmax(420px,0.95fr)]">
        {/* Hero */}
        <motion.section
          variants={stagger(0.08)}
          initial="initial"
          animate="animate"
          className="relative hidden flex-col justify-between p-10 lg:flex xl:p-14"
        >
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <Logo size={40} withWordmark />
            <Badge tone="accent" size="md">
              <Sparkles className="h-3 w-3" /> Workspace · v1.2
            </Badge>
          </motion.div>

          <div className="max-w-[560px] space-y-6">
            <motion.h1
              variants={fadeUp}
              className="text-[44px] font-bold leading-[1.05] tracking-[-0.03em] xl:text-[52px]"
            >
              {headline}
            </motion.h1>
            <motion.p variants={fadeUp} className="text-[15px] leading-[1.7] text-[var(--c-fg-dim)]">
              {sub}
            </motion.p>

            <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 pt-2">
              {pillars.map((p) => (
                <div
                  key={p.title}
                  className="group/feat relative overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[color-mix(in_srgb,var(--c-surface)_60%,transparent)] p-4 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--c-line-strong)]"
                >
                  <div
                    aria-hidden
                    className="absolute inset-x-0 -top-px h-px"
                    style={{ background: 'linear-gradient(90deg, transparent, var(--c-accent), transparent)' }}
                  />
                  <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    {p.icon}
                  </div>
                  <div className="text-[13px] font-semibold tracking-tight">{p.title}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--c-fg-muted)] leading-snug">{p.desc}</div>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[var(--c-fg-muted)]">
            {TRUST.map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--c-success)]" />
                {t}
              </span>
            ))}
          </motion.div>
        </motion.section>

        {/* Form panel */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
          className="relative flex items-center justify-center p-6 sm:p-10"
        >
          <div className="lg:hidden absolute top-6 left-6">
            <Logo size={36} withWordmark />
          </div>
          <div className="relative w-full max-w-md">
            <div
              aria-hidden
              className="absolute -inset-px rounded-3xl opacity-60"
              style={{
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--c-accent) 30%, transparent), transparent 30%)',
                filter: 'blur(20px)',
              }}
            />
            <div className="relative overflow-hidden rounded-3xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_85%,transparent)] backdrop-blur-xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.45)]">
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{ background: 'linear-gradient(90deg, transparent, var(--c-accent-2), transparent)' }}
              />
              <div className="p-7 sm:p-8">{children}</div>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
