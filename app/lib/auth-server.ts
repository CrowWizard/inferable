// Server-side auth stub — no "use client" directive.
// Used by server components that previously called Clerk's auth().

const FIXED_TOKEN =
  process.env.INFERABLE_AUTH_TOKEN ||
  process.env.NEXT_PUBLIC_INFERABLE_AUTH_TOKEN ||
  "dev-token";

export function auth() {
  const getToken = async () => FIXED_TOKEN;
  return {
    getToken,
    userId: "dev-user",
    orgId: "dev-org",
    orgRole: "org:admin",
    orgSlug: "dev-org",
    sessionClaims: {},
    sessionId: "dev-session",
    isAuthenticated: true,
  };
}
