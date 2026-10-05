// Client auth stub: stores anon Supabase session token for join.
// Prod: supabase-js sign-in (email/OAuth) then pass access_token to room.
export function getDevToken(): string {
  let t = localStorage.getItem('dev-token');
  if (!t) {
    t = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('dev-token', t);
  }
  return t;
}
