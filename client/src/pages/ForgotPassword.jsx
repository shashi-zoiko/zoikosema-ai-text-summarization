import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react'
import Logo from '../components/ui/Logo'
import { Input, Field } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { requestPasswordReset, verifyResetOtp, resetPassword } from '../api/client'
import { cn } from '../lib/cn'

const OTP_LENGTH = 4
const RESEND_SECONDS = 60
const EASE = [0.16, 1, 0.3, 1]

const STEPS = ['email', 'otp', 'password', 'done']

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function passwordChecks(p) {
  return {
    length: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    digit: /[0-9]/.test(p),
    special: /[^A-Za-z0-9]/.test(p),
  }
}

// Shared CTA button styling (mirrors Login/Register) so the flow feels native.
const ctaClass =
  'group/cta relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-transparent bg-[linear-gradient(115deg,#2563eb_0%,#4f46e5_50%,#7c3aed_100%)] px-6 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(79,70,229,0.5),inset_0_1px_0_rgba(255,255,255,0.22)] outline-none transition-[filter,box-shadow] duration-200 hover:brightness-[1.08] hover:saturate-110 hover:shadow-[0_18px_36px_-10px_rgba(124,58,237,0.6),inset_0_1px_0_rgba(255,255,255,0.28)] focus-visible:ring-4 focus-visible:ring-[rgba(124,58,237,0.35)] disabled:cursor-not-allowed disabled:opacity-60'

function CtaButton({ busy, busyLabel, children, disabled }) {
  return (
    <motion.button
      type="submit"
      disabled={busy || disabled}
      whileHover={{ scale: busy || disabled ? 1 : 1.015 }}
      whileTap={{ scale: busy || disabled ? 1 : 0.985 }}
      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
      className={ctaClass}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-full"
      />
      <span className="relative inline-flex items-center gap-2">
        {busy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            {busyLabel}
          </>
        ) : (
          children
        )}
      </span>
    </motion.button>
  )
}

function ErrorAlert({ message }) {
  return (
    <AnimatePresence>
      {message && (
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
            <span className="font-medium">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function ForgotPassword() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step, setStep] = useState('email')
  const [dir, setDir] = useState(1) // animation direction: 1 forward, -1 back
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(''))
  const [resetToken, setResetToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const otpRefs = useRef([])

  const go = (next) => {
    setError('')
    setDir(STEPS.indexOf(next) >= STEPS.indexOf(step) ? 1 : -1)
    setStep(next)
  }

  // Resend countdown — runs whenever there's time on the clock.
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [secondsLeft])

  // Focus the first OTP box when we land on that step.
  useEffect(() => {
    if (step === 'otp') {
      setOtp(Array(OTP_LENGTH).fill(''))
      requestAnimationFrame(() => otpRefs.current[0]?.focus())
    }
  }, [step])

  const checks = useMemo(() => passwordChecks(password), [password])
  const passOk = Object.values(checks).every(Boolean)
  const confirmOk = confirm.length > 0 && confirm === password
  const emailOk = isValidEmail(email.trim())
  const otpValue = otp.join('')
  const otpComplete = otpValue.length === OTP_LENGTH

  // ── Step 1: request the code ──────────────────────────────────────────────
  const submitEmail = async (e) => {
    e.preventDefault()
    if (!emailOk || busy) return
    setError('')
    setBusy(true)
    try {
      await requestPasswordReset(email.trim().toLowerCase())
      toast({ variant: 'success', title: 'Check your inbox', description: 'If an account exists, a verification code is on its way.' })
      setSecondsLeft(RESEND_SECONDS)
      go('otp')
    } catch (err) {
      setError(err.message || 'Could not send the verification code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (secondsLeft > 0 || busy) return
    setError('')
    setBusy(true)
    try {
      await requestPasswordReset(email.trim().toLowerCase())
      toast({ variant: 'success', title: 'Code resent', description: 'A new verification code has been sent.' })
      setOtp(Array(OTP_LENGTH).fill(''))
      otpRefs.current[0]?.focus()
      setSecondsLeft(RESEND_SECONDS)
    } catch (err) {
      toast({ variant: 'error', title: 'Could not resend', description: err.message || 'Please try again shortly.' })
    } finally {
      setBusy(false)
    }
  }

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  const setOtpDigit = (i, val) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    setOtp((prev) => {
      const next = [...prev]
      next[i] = digit
      return next
    })
    if (digit && i < OTP_LENGTH - 1) otpRefs.current[i + 1]?.focus()
  }

  const onOtpKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      otpRefs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) {
      otpRefs.current[i + 1]?.focus()
    }
  }

  const onOtpPaste = (e) => {
    e.preventDefault()
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!digits) return
    const next = Array(OTP_LENGTH).fill('')
    for (let i = 0; i < digits.length; i++) next[i] = digits[i]
    setOtp(next)
    otpRefs.current[Math.min(digits.length, OTP_LENGTH - 1)]?.focus()
  }

  const submitOtp = async (e) => {
    e?.preventDefault()
    if (!otpComplete || busy) return
    setError('')
    setBusy(true)
    try {
      const res = await verifyResetOtp(email.trim().toLowerCase(), otpValue)
      setResetToken(res.reset_token)
      toast({ variant: 'success', title: 'Verified', description: 'Now choose a new password.' })
      go('password')
    } catch (err) {
      setError(err.message || 'Invalid verification code.')
      setOtp(Array(OTP_LENGTH).fill(''))
      otpRefs.current[0]?.focus()
    } finally {
      setBusy(false)
    }
  }

  // ── Step 3: set new password ──────────────────────────────────────────────
  const submitPassword = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!passOk) return setError('Please meet all the password requirements.')
    if (!confirmOk) return setError('Passwords do not match.')
    setError('')
    setBusy(true)
    try {
      await resetPassword(email.trim().toLowerCase(), resetToken, password)
      toast({ variant: 'success', title: 'Password updated', description: 'You can now sign in with your new password.' })
      go('done')
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err.message || 'Could not update your password. Please start over.')
    } finally {
      setBusy(false)
    }
  }

  const headings = {
    email: { title: 'Forgot password', sub: 'Enter your work email to receive a verification code.' },
    otp: { title: 'Verify your email', sub: `Enter the ${OTP_LENGTH}-digit code sent to ${email.trim().toLowerCase()}.` },
    password: { title: 'Create new password', sub: 'Choose a strong password you haven’t used before.' },
    done: { title: 'Password reset', sub: 'Redirecting you to sign in…' },
  }

  const slide = {
    initial: (d) => ({ opacity: 0, x: d * 28 }),
    animate: { opacity: 1, x: 0 },
    exit: (d) => ({ opacity: 0, x: d * -28 }),
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
          style={{ background: 'radial-gradient(closest-side, #c9f5e2, transparent 70%)' }}
        />
      </div>

      <div className="relative w-full max-w-[480px]">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: EASE }}
          className="relative rounded-3xl border border-[var(--c-line)] bg-white p-8 shadow-[0_30px_80px_-30px_rgba(91,103,242,0.35),0_2px_4px_rgba(15,23,42,0.04)] sm:p-10"
        >
          {/* Logo + step heading */}
          <div className="flex flex-col items-center text-center">
            <motion.div
              whileHover={{ scale: 1.04, y: -2 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              className="cursor-default"
            >
              <Logo size={56} withWordmark className="drop-shadow-[0_8px_20px_rgba(71,71,135,0.18)]" />
            </motion.div>

            {/* Step indicator (hidden on success) */}
            {step !== 'done' && (
              <div className="mt-5 flex items-center">
                {['email', 'otp', 'password'].map((s, i) => {
                  const idx = STEPS.indexOf(step)
                  const done = idx > i
                  const current = idx === i
                  return (
                    <div key={s} className="flex items-center">
                      <motion.span
                        animate={{
                          backgroundColor: done || current ? 'var(--c-accent)' : 'transparent',
                          borderColor: done || current ? 'var(--c-accent)' : 'var(--c-line-strong)',
                          color: done || current ? '#ffffff' : 'var(--c-fg-muted)',
                        }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="flex h-7 w-7 items-center justify-center rounded-full border text-[12.5px] font-semibold"
                      >
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                      </motion.span>
                      {i < 2 && (
                        <motion.span
                          animate={{ backgroundColor: done ? 'var(--c-accent)' : 'var(--c-line-strong)' }}
                          transition={{ duration: 0.3, ease: EASE }}
                          className="h-0.5 w-7"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={`head-${step}`}
                custom={dir}
                variants={slide}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.3, ease: EASE }}
              >
                <h1 className="mt-5 text-[26px] font-bold tracking-[-0.02em] text-[var(--c-fg)]">
                  {headings[step].title}
                </h1>
                <p className="mt-1.5 text-[13.5px] font-medium leading-relaxed text-[var(--c-fg-muted)]">
                  {headings[step].sub}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Step body */}
          <div className="mt-8">
            <AnimatePresence mode="wait" custom={dir}>
              {/* ── Step 1: email ── */}
              {step === 'email' && (
                <motion.form
                  key="form-email"
                  custom={dir}
                  variants={slide}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.3, ease: EASE }}
                  onSubmit={submitEmail}
                  noValidate
                  className="space-y-5"
                >
                  <ErrorAlert message={error} />
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

                  {/* Reassurance box */}
                  <div className="flex items-start gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 p-3.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <div className="text-[12.5px] leading-relaxed">
                      <p className="font-semibold text-[var(--c-fg-dim)]">Secure &amp; private</p>
                      <p className="text-[var(--c-fg-muted)]">
                        We&apos;ll send a {OTP_LENGTH}-digit verification code to your work email.
                      </p>
                    </div>
                  </div>

                  <CtaButton busy={busy} busyLabel="Sending code…" disabled={!emailOk}>
                    Send verification code
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
                  </CtaButton>
                </motion.form>
              )}

              {/* ── Step 2: OTP ── */}
              {step === 'otp' && (
                <motion.form
                  key="form-otp"
                  custom={dir}
                  variants={slide}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.3, ease: EASE }}
                  onSubmit={submitOtp}
                  noValidate
                  className="space-y-5"
                >
                  <ErrorAlert message={error} />
                  <div
                    className="flex items-center justify-center gap-3"
                    onPaste={onOtpPaste}
                  >
                    {otp.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => (otpRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={1}
                        value={d}
                        onChange={(e) => setOtpDigit(i, e.target.value)}
                        onKeyDown={(e) => onOtpKeyDown(i, e)}
                        aria-label={`Digit ${i + 1}`}
                        className={cn(
                          'h-16 w-14 rounded-2xl border bg-[var(--c-bg-1)] text-center text-[28px] font-bold text-[var(--c-fg)]',
                          'border-[var(--c-line-strong)] outline-none transition-[border-color,box-shadow,background] duration-150',
                          'focus:border-[var(--c-accent)] focus:bg-[var(--c-surface-2)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]',
                          d && 'border-[var(--c-accent)]'
                        )}
                      />
                    ))}
                  </div>

                  <CtaButton busy={busy} busyLabel="Verifying…" disabled={!otpComplete}>
                    Verify code
                    <ShieldCheck className="h-4 w-4" />
                  </CtaButton>

                  <div className="flex items-center justify-center text-[13px] text-[var(--c-fg-muted)]">
                    {secondsLeft > 0 ? (
                      <span>
                        Resend available in{' '}
                        <span className="font-semibold text-[var(--c-fg-dim)] tabular-nums">{secondsLeft}s</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={resend}
                        disabled={busy}
                        className="font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)] disabled:opacity-60"
                      >
                        Resend code
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => go('email')}
                    className="mx-auto flex items-center gap-1.5 text-[13px] font-medium text-[var(--c-fg-muted)] transition-colors hover:text-[var(--c-fg-dim)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Use a different email
                  </button>
                </motion.form>
              )}

              {/* ── Step 3: new password ── */}
              {step === 'password' && (
                <motion.form
                  key="form-password"
                  custom={dir}
                  variants={slide}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.3, ease: EASE }}
                  onSubmit={submitPassword}
                  noValidate
                  className="space-y-5"
                >
                  <ErrorAlert message={error} />
                  <Field label="New password">
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus
                      placeholder="Choose a strong password"
                      autoComplete="new-password"
                      rightAddon={
                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          aria-label={showPwd ? 'Hide password' : 'Show password'}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--c-fg-muted)] transition-colors duration-150 hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)]"
                        >
                          {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      }
                    />
                  </Field>

                  {/* Live requirements checklist */}
                  <AnimatePresence initial={false}>
                    {password.length > 0 && (
                      <motion.ul
                        key="checklist"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className="grid grid-cols-2 gap-x-3 gap-y-1.5 overflow-hidden rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 p-3 text-[11.5px]"
                      >
                        {[
                          { key: 'length', label: 'Min 8 characters' },
                          { key: 'upper', label: 'Uppercase' },
                          { key: 'lower', label: 'Lowercase' },
                          { key: 'digit', label: 'Number' },
                          { key: 'special', label: 'Special character' },
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
                      </motion.ul>
                    )}
                  </AnimatePresence>

                  <Field label="Confirm password" error={confirm.length > 0 && !confirmOk ? 'Passwords do not match' : undefined}>
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      error={confirm.length > 0 && !confirmOk}
                    />
                  </Field>

                  <CtaButton busy={busy} busyLabel="Updating password…" disabled={!passOk || !confirmOk}>
                    Reset password
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
                  </CtaButton>
                </motion.form>
              )}

              {/* ── Step 4: success ── */}
              {step === 'done' && (
                <motion.div
                  key="form-done"
                  custom={dir}
                  variants={slide}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex flex-col items-center text-center"
                >
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--c-accent-soft)]"
                  >
                    <CheckCircle2 className="h-9 w-9 text-[var(--c-success)]" />
                  </motion.div>
                  <p className="mt-5 text-[14px] font-medium text-[var(--c-fg-dim)]">
                    Password reset successful.
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--c-fg-muted)]">
                    You can now sign in using your new password.
                  </p>
                  <Link
                    to="/login"
                    className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)]"
                  >
                    Go to sign in
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer link beneath card */}
        {step !== 'done' && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="mt-6 text-center text-[13px] text-[var(--c-fg-muted)]"
          >
            Remembered it?{' '}
            <Link
              to="/login"
              className="group/link relative font-semibold text-[var(--c-accent)] transition-colors duration-150 hover:text-[var(--c-accent-2)]"
            >
              Back to sign in
              <span className="absolute -bottom-0.5 left-0 right-0 h-px origin-left scale-x-0 bg-[var(--c-accent)] transition-transform duration-200 group-hover/link:scale-x-100" />
            </Link>
          </motion.p>
        )}
      </div>
    </div>
  )
}
