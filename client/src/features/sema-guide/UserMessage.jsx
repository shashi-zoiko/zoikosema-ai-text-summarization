export default function UserMessage({ content, timestamp }) {
  return (
    <div className="flex max-w-[85%] flex-col gap-1 self-end">
      <div className="self-end rounded-2xl rounded-br-sm bg-[var(--c-accent)] px-4 py-3 text-[13px] leading-relaxed text-white shadow-sm">
        <div className="whitespace-pre-wrap break-words">{content}</div>
      </div>
      {timestamp && (
        <span className="self-end px-1 text-[10px] text-[var(--c-fg-muted)]">
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}
