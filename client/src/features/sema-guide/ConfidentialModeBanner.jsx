import { Shield, ShieldOff } from 'lucide-react'

import { t } from '../../lib/i18n'

export default function ConfidentialModeBanner({ active = false }) {
  if (!active) return null

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--c-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--c-warn)_8%,transparent)]">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-warn)]" />
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold text-[var(--c-warn)]">{t('guide.confidential.title')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--c-fg-dim)]">
            {t('guide.confidential.body')}
          </p>
        </div>
      </div>
    </div>
  )
}
