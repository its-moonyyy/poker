// Auth v1: dev stub. Prod TODO: verify Supabase JWT with service-role
// (never expose SERVICE_KEY to client) and return `sub`.
export async function verifyToken(token: string): Promise<string> {
  if (!token) throw new Error('NO_TOKEN');
  if (process.env.SUPABASE_URL) {
    // TODO(prod): createClient(SUPABASE_URL, SERVICE_KEY).auth.getUser(token)
    throw new Error('SUPABASE_VERIFY_NOT_WIRED');
  }
  return token;
}
