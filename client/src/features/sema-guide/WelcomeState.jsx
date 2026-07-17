import { useEffect } from 'react'
import { useSemaGuide } from './store'

export default function WelcomeState() {
  const {
    sendMessage,
    rankedActions,
    rankedActionsLoading,
    rankedActionsError,
    fetchRankedActions,
    setSecondaryView,
  } = useSemaGuide()

  useEffect(() => {
    if (!rankedActions && !rankedActionsLoading && !rankedActionsError) {
      fetchRankedActions()
    }
  }, [rankedActions, rankedActionsLoading, rankedActionsError, fetchRankedActions])

  return (
    <div className="flex flex-col gap-4">
      {/* Welcome Card */}
      <div className="rounded-[16px] p-5" style={{ backgroundColor: '#F5F7FC' }}>
        <h3 className="text-[15px] font-bold leading-snug" style={{ color: '#111827' }}>
          Hello — I'm Sema Guide, Zoiko Sema's AI support agent.
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: '#6B7280' }}>
          I can answer questions about Zoiko Sema features, help with common tasks, and connect you with a human specialist when needed.
        </p>
      </div>

      {/* Recommended Section */}
      <div>
        <p
          className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: '#6B7280' }}
        >
          Recommended
        </p>

        {rankedActionsLoading && (
          <div className="flex items-center justify-center py-4">
            <svg className="h-5 w-5 animate-spin" style={{ color: '#6B7280' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {rankedActionsError && (
          <div className="rounded-xl px-4 py-3 text-[12px] leading-relaxed text-center" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>
            Could not load suggestions.
            <button
              type="button"
              onClick={fetchRankedActions}
              className="ml-1.5 font-medium underline underline-offset-2"
              style={{ color: '#991B1B', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            >
              Retry
            </button>
          </div>
        )}

        {rankedActions && !rankedActionsLoading && !rankedActionsError && (
          <div className="grid grid-cols-2 gap-2">
            {rankedActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => sendMessage(action.label)}
                className="sg-action flex h-[38px] items-center justify-center rounded-xl border px-3 text-[12.5px] font-semibold transition-all duration-150"
                style={{
                  borderColor: '#3F63F2',
                  color: '#3F63F2',
                  backgroundColor: '#FFFFFF',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#3F63F2'
                  e.currentTarget.style.color = '#FFFFFF'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.color = '#3F63F2'
                }}
                title={action.description || ''}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI Notice */}
      <div
        className="rounded-xl px-4 py-3 text-[12px] leading-relaxed"
        style={{ backgroundColor: '#F0F5FF' }}
      >
        <span style={{ color: '#374151' }}>You are interacting with AI. </span>
        <button
          type="button"
          onClick={() => setSecondaryView('privacy')}
          className="font-medium underline-offset-2 hover:underline"
          style={{ color: '#3F63F2', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
        >
          How your data is handled
        </button>
      </div>
    </div>
  )
}
