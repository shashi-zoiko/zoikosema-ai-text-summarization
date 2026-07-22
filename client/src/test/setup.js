import '@testing-library/jest-dom/vitest'

// jsdom does not implement matchMedia; useMediaQuery and the responsive adapter
// depend on it. A minimal, overridable stub keeps DOM tests deterministic.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
