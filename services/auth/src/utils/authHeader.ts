export class MissingOrInvalidAuthHeaderError extends Error {}

/**
 * Extracts the bearer token from an `Authorization` header value.
 * Throws MissingOrInvalidAuthHeaderError if the header is absent or
 * malformed — callers should map that to a 401 response.
 */
export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new MissingOrInvalidAuthHeaderError('missing Authorization header');
  }
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new MissingOrInvalidAuthHeaderError('Authorization header must be "Bearer <token>"');
  }
  return token;
}
