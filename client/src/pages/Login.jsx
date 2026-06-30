import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowRight, Eye, EyeOff, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/ui/Logo'
import { Input, Field } from '../components/ui/Input'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Sign in failed')
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
            <h1 className="mt-6 text-[26px] font-bold tracking-[-0.02em] text-[var(--c-fg)]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-[13.5px] text-[var(--c-fg-muted)]">
              Sign in to your workspace and continue
            </p>
            <p className="mt-1.5 text-[13.5px] font-semibold">
              <span className="bg-[linear-gradient(110deg,#15936b,#15936b_42%,#2563eb)] bg-clip-text text-transparent">
                Meet · Chat · Collaborate
              </span>
            </p>
          </motion.div>

          {/* Form */}
          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
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
              transition={{ delay: 0.18, duration: 0.4 }}
            >
              <Field label="Work email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@company.com"
                  autoComplete="email"
                  leftIcon={<Mail />}
                />
              </Field>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.4 }}
            >
              <Field label="Password">
                <Input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  autoComplete="current-password"
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
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.35 }}
              className="flex items-center justify-between"
            >
              <label className="inline-flex select-none items-center gap-2 text-[13px] font-medium text-[var(--c-fg-dim)]">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-[5px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] transition-all duration-150 peer-checked:border-[var(--c-accent)] peer-checked:bg-[var(--c-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--c-accent-ring)] after:absolute after:left-1/2 after:top-1/2 after:h-2 after:w-1 after:-translate-x-1/2 after:-translate-y-[65%] after:rotate-45 after:border-b-2 after:border-r-2 after:border-white after:opacity-0 peer-checked:after:opacity-100" />
                Remember this device
              </label>
              <Link
                to="/forgot-password"
                className="text-[13px] font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)]"
              >
                Forgot password?
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.36, duration: 0.4 }}
              className="relative pt-1"
            >
              {/* Soft glow under the button — intensifies on hover */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-3 -bottom-2 h-8 rounded-full opacity-40 blur-xl transition-opacity duration-300 group-hover/cta:opacity-90"
                style={{ background: 'linear-gradient(90deg, #13a06a, #2563eb)' }}
              />
              <motion.button
                type="submit"
                disabled={busy}
                whileHover={{ scale: busy ? 1 : 1.015 }}
                whileTap={{ scale: busy ? 1 : 0.985 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="group/cta relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-transparent bg-[linear-gradient(115deg,#13a06a_0%,#1f8fb8_48%,#2563eb_100%)] px-6 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(37,99,235,0.5),inset_0_1px_0_rgba(255,255,255,0.22)] outline-none transition-[filter,box-shadow] duration-200 hover:brightness-[1.08] hover:saturate-110 hover:shadow-[0_18px_36px_-10px_rgba(37,99,235,0.6),inset_0_1px_0_rgba(255,255,255,0.28)] focus-visible:ring-4 focus-visible:ring-[var(--c-accent-ring)] disabled:cursor-not-allowed disabled:opacity-80"
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
                      Signing you in…
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
                    </>
                  )}
                </span>
              </motion.button>
            </motion.div>
          </form>
        </motion.div>

        {/* Footer link beneath card */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.58, duration: 0.4 }}
          className="mt-6 text-center text-[15px] text-[var(--c-fg-muted)]"
        >
          New to ZoikoSema?{' '}
          <Link
            to="/register"
            className="group/link relative font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)]"
          >
            Create your workspace
            <span className="absolute -bottom-0.5 left-0 right-0 h-px origin-left scale-x-0 bg-[var(--c-accent)] transition-transform duration-200 group-hover/link:scale-x-100" />
          </Link>
        </motion.p>
      </div>
    </div>
  )
}
