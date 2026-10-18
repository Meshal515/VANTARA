/** Username policy mirrored in sync-worker/accounts.ts; web files ship alone in APKs. */
const usernameCharacter = (c) => /^[a-z0-9_.]$/.test(c) || (/\p{Script_Extensions=Arabic}/u.test(c) && /[\p{L}\p{N}]/u.test(c));
export function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.normalize('NFKC').replace(/^@/, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
  const length = [...username].length;
  return length >= 3 && length <= 20 && [...username].every(usernameCharacter) ? username : null;
}
