import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'zoiko_theme'

export const THEMES = [
  { id: 'midnight', label: 'Midnight Graphite', mode: 'dark', desc: 'Charcoal canvas with indigo accents.' },
  { id: 'aurora',   label: 'Aurora',            mode: 'dark', desc: 'Ambient blue–purple atmosphere.' },
  { id: 'light',    label: 'Light Enterprise',  mode: 'light', desc: 'Linear-inspired productivity light.' },
]

const ThemeContext = createContext({
  theme: 'midnight',
  setTheme: () => {},
  themes: THEMES,
})

function readInitial() {
  if (typeof window === 'undefined') return 'midnight'
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    if (t && THEMES.some((x) => x.id === t)) return t
  } catch {}
  return 'midnight'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitial)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  const setTheme = useCallback((id) => {
    if (THEMES.some((t) => t.id === id)) setThemeState(id)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
