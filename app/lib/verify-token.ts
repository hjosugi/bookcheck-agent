import { CognitoJwtVerifier } from 'aws-jwt-verify'

// Verify Cognito access tokens on the server side.
// Route Handlers must not trust the client. They check the JWT here.

// Local mode skips Cognito so the app runs without any cloud auth.
// It is refused in production builds no matter what the env says.
const LOCAL_AUTH = process.env.LOCAL_AUTH === '1' && process.env.NODE_ENV !== 'production'

const LOCAL_USER_SUB = 'local-dev-user'

// Built lazily so local mode does not need Cognito env vars at all.
let cachedVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null

function getVerifier() {
  if (!cachedVerifier) {
    cachedVerifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      tokenUse: 'access',
      clientId: process.env.COGNITO_CLIENT_ID!,
    })
  }
  return cachedVerifier
}

export interface AuthedUser {
  // Cognito user id. Stable per user. Used as the partition key owner.
  sub: string
}

// Verify a raw access token. Used where the token does not arrive in an
// Authorization header: the OAuth callback is a top-level redirect from
// Google, so the browser sends cookies and nothing else.
export async function verifyAccessToken(token: string): Promise<AuthedUser | null> {
  if (!token) return null
  if (LOCAL_AUTH) return { sub: LOCAL_USER_SUB }
  try {
    const payload = await getVerifier().verify(token)
    return { sub: payload.sub }
  } catch (error) {
    // Log the reason, never the token. Every failure here leaves the caller
    // with a bare 401, which cannot distinguish a missing COGNITO_* variable
    // (getVerifier throws before any check runs) from an expired token or a
    // client-id mismatch. Without this line the only way to tell them apart
    // is to redeploy with logging added.
    console.error(
      '[auth] access token rejected:',
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    )
    return null
  }
}

// Read the Bearer token and verify it.
// Return the user, or null when the token is missing or invalid.
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  if (LOCAL_AUTH) return { sub: LOCAL_USER_SUB }

  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return verifyAccessToken(token)
}
