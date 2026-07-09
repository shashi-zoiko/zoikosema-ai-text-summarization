import { Component } from 'react'

/**
 * Wraps the room so a single broken tile or panel doesn't blank the call.
 * On caught error, shows a fallback with a refresh button and prints to
 * console (Sentry/OTel can pick this up in prod).
 */
export default class RoomErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Room render error', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    // Scoped use (e.g. the notebook panel): render a caller-supplied fallback so
    // one broken panel doesn't blank the whole call. reset() clears the error so
    // the panel can be reopened.
    if (this.props.fallback) {
      return this.props.fallback({
        error: this.state.error,
        reset: () => this.setState({ error: null }),
      })
    }
    return (
      <div className="h-dvh w-screen grid place-items-center bg-zinc-950 text-zinc-200 p-6">
        <div className="text-center max-w-md">
          <div className="text-lg font-semibold mb-2">Something broke in the call view</div>
          <div className="text-xs text-zinc-400 mb-4 font-mono">
            {String(this.state.error?.message || this.state.error)}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
            >
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-white"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
