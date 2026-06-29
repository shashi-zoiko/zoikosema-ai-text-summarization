import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/ui/Logo'
import { Input, Field } from '../components/ui/Input'
import { cn } from '../lib/cn'

function passwordChecks(p) {
  return {
    length: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    digit: /[0-9]/.test(p),
  }
}

const STRENGTH_LABELS = ['Weak', 'Weak', 'Okay', 'Good', 'Strong']

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const checks = useMemo(() => passwordChecks(password), [password])
  const strength = useMemo(() => Object.values(checks).filter(Boolean).length, [checks])
  const strengthLabel = STRENGTH_LABELS[strength]
  const strengthTone = strength < 2 ? 'danger' : strength < 4 ? 'warn' : 'success'

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!checks.length) return setError('Password must be at least 8 characters')
    if (!checks.upper || !checks.lower || !checks.digit) {
      return setError('Password must contain uppercase, lowercase, and a digit')
    }
    setBusy(true)
    try {
      await register(email.trim(), name.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Sign up failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-theme="light" className="relative isolate flex min-h-dvh items-center justify-center overflow-x-hidden bg-[var(--c-bg)] px-4 py-10 text-[var(--c-fg)]">
      {/* Soft ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-48 -left-32 h-[520px] w-[520px] rounded-full opacity-50 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #d6dcff, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-48 -right-24 h-[600px] w-[600px] rounded-full opacity-50 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #f5dcff, transparent 70%)' }}
        />
      </div>

      <div className="relative w-full max-w-[480px]">
        {/* ──────────────── Card ──────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl border border-[var(--c-line)] bg-white p-8 shadow-[0_30px_80px_-30px_rgba(91,103,242,0.35),0_2px_4px_rgba(15,23,42,0.04)] sm:p-10"
        >
          {/* Logo + heading */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center"
          >
            <motion.div
              whileHover={{ scale: 1.04, y: -2 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              className="cursor-default"
            >
              <Logo size={56} withWordmark className="drop-shadow-[0_8px_20px_rgba(71,71,135,0.18)]" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.4 }}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--c-fg-dim)]"
            >
              <Sparkles className="h-3 w-3 text-[var(--c-accent)]" />
              Get started — free for your team
            </motion.div>

            <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em] text-[var(--c-fg)]">
              Create your workspace
            </h1>
            <p className="mt-1.5 text-[13.5px] font-medium text-[var(--c-fg-muted)]">
              <span className="bg-[linear-gradient(120deg,#1f7a54,#15936b_50%,#34d399)] bg-clip-text text-transparent">
                Meet · Chat · Collaborate
              </span>
            </p>
          </motion.div>

          {/* Form */}
          <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
            <AnimatePresence>
              {error && (
                <motion.div
                  key="err"
                  role="alert"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2.5 rounded-xl border border-[var(--c-danger)]/40 bg-[var(--c-danger-soft)] p-3 text-[13px] text-[var(--c-danger)]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="font-medium">{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.4 }}
            >
              <Field label="Full name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </Field>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.4 }}
            >
              <Field label="Work email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </Field>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.4 }}
            >
              <Field label="Password">
                <Input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Choose a strong password"
                  autoComplete="new-password"
                  rightAddon={
                    <motion.button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                      whileTap={{ scale: 0.88 }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--c-fg-muted)] transition-colors duration-150 hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)]"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={showPwd ? 'eye-off' : 'eye-on'}
                          initial={{ opacity: 0, rotate: -20, scale: 0.85 }}
                          animate={{ opacity: 1, rotate: 0, scale: 1 }}
                          exit={{ opacity: 0, rotate: 20, scale: 0.85 }}
                          transition={{ duration: 0.18 }}
                          className="flex"
                        >
                          {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </motion.span>
                      </AnimatePresence>
                    </motion.button>
                  }
                />
              </Field>

              {/* Strength meter slides in only when there is input */}
              <AnimatePresence initial={false}>
                {password.length > 0 && (
                  <motion.div
                    key="pwd-meter"
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex h-1.5 flex-1 gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <motion.span
                              key={i}
                              initial={false}
                              animate={{
                                backgroundColor:
                                  i < strength
                                    ? strengthTone === 'danger'
                                      ? 'var(--c-danger)'
                                      : strengthTone === 'warn'
                                      ? 'var(--c-warn)'
                                      : 'var(--c-success)'
                                    : 'var(--c-line-strong)',
                              }}
                              transition={{ duration: 0.25 }}
                              className="h-full flex-1 rounded-full"
                            />
                          ))}
                        </div>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={strengthLabel + strengthTone}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.18 }}
                            className={cn(
                              'text-[11px] font-semibold tracking-tight',
                              strengthTone === 'danger' && 'text-[var(--c-danger)]',
                              strengthTone === 'warn' && 'text-[var(--c-warn)]',
                              strengthTone === 'success' && 'text-[var(--c-success)]'
                            )}
                          >
                            {strengthLabel}
                          </motion.span>
                        </AnimatePresence>
                      </div>
                      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                        {[
                          { key: 'length', label: '8+ characters' },
                          { key: 'upper', label: 'Uppercase letter' },
                          { key: 'lower', label: 'Lowercase letter' },
                          { key: 'digit', label: 'A number' },
                        ].map((r) => {
                          const ok = checks[r.key]
                          return (
                            <li
                              key={r.key}
                              className={cn(
                                'flex items-center gap-1.5 transition-colors duration-200',
                                ok ? 'text-[var(--c-success)]' : 'text-[var(--c-fg-muted)]'
                              )}
                            >
                              <motion.span
                                animate={{ scale: ok ? 1 : 0.85, opacity: ok ? 1 : 0.4 }}
                                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                                className="flex h-3.5 w-3.5 items-center justify-center"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </motion.span>
                              {r.label}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.42, duration: 0.4 }}
              className="relative pt-1"
            >
              {/* Soft glow under the button — intensifies on hover */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-3 -bottom-2 h-8 rounded-full opacity-40 blur-xl transition-opacity duration-300 group-hover/cta:opacity-90"
                style={{ background: 'linear-gradient(90deg, #1f7a54, #34d399)' }}
              />
              <motion.button
                type="submit"
                disabled={busy}
                whileHover={{ scale: busy ? 1 : 1.015 }}
                whileTap={{ scale: busy ? 1 : 0.985 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="group/cta relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-transparent bg-[linear-gradient(135deg,#1f7a54_0%,#15936b_55%,#34d399_100%)] px-6 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(31,122,84,0.55),inset_0_1px_0_rgba(255,255,255,0.22)] outline-none transition-[filter,box-shadow] duration-200 hover:brightness-[1.08] hover:saturate-110 hover:shadow-[0_18px_36px_-10px_rgba(31,122,84,0.65),inset_0_1px_0_rgba(255,255,255,0.28)] focus-visible:ring-4 focus-visible:ring-[var(--c-accent-ring)] disabled:cursor-not-allowed disabled:opacity-80"
              >
                {/* Shine sweep */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-full"
                />
                <span className="relative inline-flex items-center gap-2">
                  {busy ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating your workspace…
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
                    </>
                  )}
                </span>
              </motion.button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="text-center text-[11.5px] leading-relaxed text-[var(--c-fg-muted)]"
            >
              By continuing you agree to our{' '}
              <a className="font-medium text-[var(--c-fg-dim)] underline underline-offset-2 transition-colors hover:text-[var(--c-accent)]" href="#">
                Terms
              </a>{' '}
              and{' '}
              <a className="font-medium text-[var(--c-fg-dim)] underline underline-offset-2 transition-colors hover:text-[var(--c-accent)]" href="#">
                Privacy Policy
              </a>
              .
            </motion.p>
          </form>
        </motion.div>

        {/* Footer link beneath card */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="mt-6 text-center text-[13px] text-[var(--c-fg-muted)]"
        >
          Already have an account?{' '}
          <Link
            to="/login"
            className="group/link relative font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)]"
          >
            Sign in
            <span className="absolute -bottom-0.5 left-0 right-0 h-px origin-left scale-x-0 bg-[var(--c-accent)] transition-transform duration-200 group-hover/link:scale-x-100" />
          </Link>
        </motion.p>
      </div>
    </div>
  )
}
