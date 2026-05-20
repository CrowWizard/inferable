"use client";

import { useCallback } from "react";

// Stub auth — bypasses Clerk, returns a fixed token.
// Set NEXT_PUBLIC_INFERABLE_AUTH_TOKEN env var or defaults to "dev-token".
const FIXED_TOKEN =
  process.env.NEXT_PUBLIC_INFERABLE_AUTH_TOKEN || "dev-token";

// Client-side useAuth hook
export function useAuth() {
  const getToken = useCallback(async () => FIXED_TOKEN, []);
  const isSignedIn = true;
  const userId = "dev-user";
  const orgId = "dev-org";
  const orgRole = "org:admin";
  const orgSlug = "dev-org";

  return { getToken, isSignedIn, userId, orgId, orgRole, orgSlug };
}

export function useUser() {
  return {
    user: {
      id: "dev-user",
      fullName: "Dev User",
      firstName: "Dev",
      lastName: "User",
      username: "dev-user",
      primaryEmailAddress: { emailAddress: "dev@example.com" },
      emailAddresses: [{ emailAddress: "dev@example.com" }],
      organizationMemberships: [
        {
          organization: {
            id: "dev-org",
            name: "Dev Org",
            slug: "dev-org",
          },
          role: "org:admin",
        },
      ],
    },
    isSignedIn: true,
    isLoaded: true,
  };
}

export function useOrganization() {
  return {
    organization: {
      id: "dev-org",
      name: "Dev Org",
      slug: "dev-org",
    },
    isLoaded: true,
  };
}
