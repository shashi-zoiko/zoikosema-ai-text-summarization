import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { decryptMessage, encryptMessage, importMessageKey } from './messageCrypto'

// Shares the per-meeting text-encryption key with everything in the room
// subtree (chat panel, caption transport). Media frames are encrypted by
// LiveKit's own E2EE — this context is only for the text channels.
//
// Value: { ready, encrypt(plaintext)->envelope, decrypt(envelope)->plaintext|null }.
// Before the key is imported, encrypt/decrypt are no-ops that pass text through,
// so nothing throws during the brief join window; `ready` tells consumers when
// real crypto is active.
const MeetingCryptoContext = createContext({
  ready: false,
  encrypt: async (t) => t,
  decrypt: async (t) => t,
})

export function useMeetingCrypto() {
  return useContext(MeetingCryptoContext)
}

export default function MeetingCryptoProvider({ keyB64, children }) {
  const [key, setKey] = useState(null)
  // Hold the key in a ref too, so the memoised encrypt/decrypt closures always
  // see the latest key without being torn down and rebuilt on every import.
  const keyRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!keyB64) {
      keyRef.current = null
      setKey(null)
      return
    }
    ;(async () => {
      try {
        const k = await importMessageKey(keyB64)
        if (cancelled) return
        keyRef.current = k
        setKey(k)
      } catch {
        keyRef.current = null
        setKey(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [keyB64])

  const value = useMemo(
    () => ({
      ready: !!key,
      encrypt: async (plaintext) => {
        const k = keyRef.current
        return k ? encryptMessage(k, plaintext) : plaintext
      },
      decrypt: async (envelope) => {
        const k = keyRef.current
        return k ? decryptMessage(k, envelope) : envelope
      },
    }),
    [key],
  )

  return <MeetingCryptoContext.Provider value={value}>{children}</MeetingCryptoContext.Provider>
}
