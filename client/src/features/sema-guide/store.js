import { create } from 'zustand'
import { api } from '../../api/client'

const WELCOME_ACTIONS_DEFAULTS = [
  { id: 'join-meeting', label: 'Join a meeting', icon: 'video', intent: 'join_meeting' },
  { id: 'fix-audio', label: 'Fix audio or video', icon: 'settings', intent: 'fix_media' },
  { id: 'compare-plans', label: 'Compare plans', icon: 'credit-card', intent: 'billing' },
  { id: 'contact-support', label: 'Contact support', icon: 'help-circle', intent: 'support' },
]

export const useSemaGuide = create((set, get) => ({
  open: false,
  isMinimized: false,
  messages: [],
  input: '',
  loading: false,
  processing: null,
  quickActions: WELCOME_ACTIONS_DEFAULTS,
  handoffState: null,
  confidential: false,
  overflowOpen: false,
  secondaryView: null,
  error: null,
  privacyData: null,
  privacyLoading: false,
  privacyError: null,
  aboutData: null,
  aboutLoading: false,
  aboutError: null,
  rankedActions: null,
  rankedActionsLoading: false,
  rankedActionsError: null,

  toggle: () => {
    const nextOpen = !get().open
    set({ open: nextOpen, isMinimized: false, overflowOpen: false, secondaryView: null })
    if (nextOpen) get().loadConversation()
  },
  openPanel: () => {
    set({ open: true })
    get().loadConversation()
  },
  closePanel: () => set({ open: false, isMinimized: false, overflowOpen: false, secondaryView: null, privacyData: null, aboutData: null }),
  minimize: () => set({ isMinimized: true }),
  restore: () => set({ isMinimized: false }),
  setSecondaryView: (view) => set({ secondaryView: view, overflowOpen: false }),
  clearSecondaryView: () => set({ secondaryView: null, privacyData: null, aboutData: null, privacyError: null, aboutError: null }),

  setInput: (input) => set({ input }),

  fetchPrivacyContext: async () => {
    set({ privacyLoading: true, privacyError: null })
    try {
      const data = await api('/api/sema-guide/privacy-context')
      set({ privacyData: data, privacyLoading: false })
    } catch (e) {
      set({ privacyError: e.message, privacyLoading: false })
    }
  },

  fetchAboutGuide: async () => {
    set({ aboutLoading: true, aboutError: null })
    try {
      const data = await api('/api/sema-guide/about')
      set({ aboutData: data, aboutLoading: false })
    } catch (e) {
      set({ aboutError: e.message, aboutLoading: false })
    }
  },

  privacyActionLoading: null,

  clearSecondaryData: () => set({ privacyData: null, aboutData: null, privacyError: null, aboutError: null }),

  fetchRankedActions: async () => {
    set({ rankedActionsLoading: true, rankedActionsError: null })
    try {
      const data = await api('/api/sema-guide/actions')
      set({ rankedActions: data.actions, rankedActionsLoading: false })
    } catch (e) {
      set({ rankedActionsError: e.message, rankedActionsLoading: false })
    }
  },

  loadConversation: async () => {
    try {
      const res = await api('/api/sema-guide/conversation')
      if (res?.messages?.length) {
        set({ messages: res.messages })
      }
    } catch {
      // silent — start fresh
    }
  },

  persistConversation: async () => {
    try {
      const msgs = get().messages
      await api('/api/sema-guide/conversation', {
        method: 'PUT',
        body: { conversation: msgs.map((m) => ({ role: m.role, content: m.content })) },
      })
    } catch {
      // silent
    }
  },

  downloadConversation: async () => {
    set({ privacyActionLoading: 'download' })
    try {
      const msgs = get().messages
      if (!msgs.length) {
        set({ privacyActionLoading: null })
        return { success: false, message: 'No messages to download.' }
      }
      const blob = new Blob([JSON.stringify({ messages: msgs, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sema-guide-conversation-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      set({ privacyActionLoading: null })
      return { success: true, message: 'Conversation downloaded.' }
    } catch (e) {
      set({ privacyActionLoading: null })
      return { success: false, message: e.message }
    }
  },

  deleteConversation: async () => {
    set({ privacyActionLoading: 'delete' })
    try {
      await api('/api/sema-guide/privacy/conversation', { method: 'DELETE' })
      set({ messages: [], privacyActionLoading: null })
      return { success: true, message: 'Conversation deleted.' }
    } catch (e) {
      set({ privacyActionLoading: null })
      return { success: false, message: e.message }
    }
  },

  fetchPrivacyPrefs: async () => {
    try {
      return await api('/api/sema-guide/privacy/preferences')
    } catch {
      return null
    }
  },

  updatePrivacyPrefs: async (data) => {
    set({ privacyActionLoading: 'prefs' })
    try {
      const res = await api('/api/sema-guide/privacy/preferences', { method: 'PUT', body: data })
      set({ privacyActionLoading: null })
      return res
    } catch (e) {
      set({ privacyActionLoading: null })
      return { success: false, message: e.message }
    }
  },

  fetchSharingPrefs: async () => {
    try {
      return await api('/api/sema-guide/privacy/sharing-preferences')
    } catch {
      return null
    }
  },

  updateSharingPrefs: async (data) => {
    set({ privacyActionLoading: 'sharing' })
    try {
      const res = await api('/api/sema-guide/privacy/sharing-preferences', { method: 'PUT', body: data })
      set({ privacyActionLoading: null })
      return res
    } catch (e) {
      set({ privacyActionLoading: null })
      return { success: false, message: e.message }
    }
  },

  submitPrivacyRequest: async (data) => {
    set({ privacyActionLoading: 'request' })
    try {
      const res = await api('/api/sema-guide/privacy/request', { method: 'POST', body: data })
      set({ privacyActionLoading: null })
      return res
    } catch (e) {
      set({ privacyActionLoading: null })
      return { success: false, message: e.message }
    }
  },

  sendMessage: async (text) => {
    const msg = text?.trim()
    if (!msg || get().loading) return

    const userMsg = { role: 'user', content: msg, timestamp: new Date().toISOString() }
    set((s) => ({ messages: [...s.messages, userMsg], input: '', loading: true, error: null }))

    try {
      const res = await api('/api/sema-guide/chat', {
        method: 'POST',
        body: { message: msg, conversation: get().messages.map((m) => ({ role: m.role, content: m.content })) },
      })
      set((s) => ({
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: res.response,
            sources: res.sources || [],
            verified: res.verified ?? false,
            action_preview: res.action_preview || null,
            timestamp: new Date().toISOString(),
          },
        ],
        loading: false,
      }))
      get().persistConversation()
    } catch (e) {
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${e.message}`, verified: false, timestamp: new Date().toISOString() }],
        loading: false,
        error: e.message,
      }))
    }
  },

  appendStreamChunk: (chunk) => {
    const { loading, messages } = get()
    if (!loading) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const updated = { ...last, content: (last.content || '') + (chunk.content || '') }
    if (chunk.sources) {
      return
    }
    set({ messages: [...messages.slice(0, -1), updated] })
  },

  setProcessing: (processing) => set({ processing }),
  clearProcessing: () => set({ processing: null }),

  requestHandoff: async () => {
    set({ handoffState: 'requesting' })
    try {
      const res = await api('/api/sema-guide/handoff', { method: 'POST' })
      set({ handoffState: res.state || 'queued' })
    } catch {
      set({ handoffState: 'failed' })
    }
  },

  fetchHandoffState: async () => {
    try {
      const res = await api('/api/sema-guide/handoff/state')
      set({ handoffState: res.state || null })
    } catch {
      // silent — polling will retry
    }
  },

  cancelHandoff: () => set({ handoffState: null }),
  setOverflowOpen: (open) => set({ overflowOpen: open }),

  clearConversation: () => {
    set({ messages: [], error: null, handoffState: null })
    get().persistConversation()
  },

  dismissError: () => set({ error: null }),
}))
