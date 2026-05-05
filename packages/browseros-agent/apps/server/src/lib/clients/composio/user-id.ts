/**
 * Extracts the user ID from a JWT access token.
 * Decodes the base64 payload and returns the `sub` claim.
 * No signature verification — the token was already verified by the gateway.
 */
export function extractUserId(authToken: string): string {
  const parts = authToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

  if (!payload.sub) {
    throw new Error('JWT missing "sub" claim')
  }

  return payload.sub as string
}
