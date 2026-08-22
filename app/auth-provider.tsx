'use client';

import type { ReactNode } from 'react';
import { LOCAL_AUTH } from './lib/auth-token';
import { AuthProvider as CognitoAuthProvider } from './providers';

// Chooses the auth wrapper at runtime.
//
// Cloud mode: the book's Cognito Authenticator (app/providers.tsx).
// Local mode: no auth at all, so the app runs with only Docker
// and a local agent. Requests carry a placeholder token that the
// Route Handlers accept when LOCAL_AUTH=1.
//
// Use this in app/layout.tsx instead of AuthProvider:
//   import { AppAuthProvider } from './auth-provider';
//   <AppAuthProvider>{children}</AppAuthProvider>

export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (LOCAL_AUTH) {
    return (
      <>
        <div className="local-badge">LOCAL MODE — auth disabled</div>
        {children}
      </>
    );
  }
  return <CognitoAuthProvider>{children}</CognitoAuthProvider>;
}
