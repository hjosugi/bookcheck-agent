'use client'

import { useState } from 'react'
import { signOut } from 'aws-amplify/auth'
import { LOCAL_AUTH } from '../lib/auth-token'

// Sign out of both halves of the session.
export function SignOutButton() {
  const [busy, setBusy] = useState(false)

  // Local mode never signs anyone in, so there is nothing to end.
  if (LOCAL_AUTH) return null

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await fetch('/api/set-token', { method: 'DELETE' })
    } catch {}
    try {
      await signOut()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="sign-out" onClick={() => void handleSignOut()} disabled={busy}>
      {busy ? 'サインアウト中…' : 'サインアウト'}
    </button>
  )
}
