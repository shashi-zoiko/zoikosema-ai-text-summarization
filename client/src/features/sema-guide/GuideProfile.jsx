import favicon from '../../assets/zoikosema-icon.svg'

export default function GuideProfile() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" style={{ flexShrink: 0 }}>
      <img src={favicon} alt="" width={34} height={34} className="rounded" />
      <div className="flex flex-col" style={{ gap: 4 }}>
        <div className="flex items-center gap-2">
          <span className="text-[20px] font-bold tracking-tight" style={{ color: '#111827' }}>
            Sema Guide
          </span>
          <span
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: '#EEF0FF', color: '#5B5FC7' }}
          >
            AI
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[15px]" style={{ color: '#6B7280' }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#10B981' }} />
          Zoiko Sema support · Online
        </div>
      </div>
    </div>
  )
}
