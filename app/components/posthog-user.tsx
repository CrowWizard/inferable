"use client";

import { useAuth, useUser, useOrganization } from "@/lib/use-auth";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

export function PostHogUser() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const { isSignedIn } = useAuth();
  const { orgRole } = useAuth();

  const posthog = usePostHog();

  useEffect(() => {
    if (!posthog) return;

    if (
      isSignedIn &&
      organization &&
      user &&
      !posthog._isIdentified() &&
      user?.primaryEmailAddress?.emailAddress
    ) {
      posthog.identify(user.id);

      posthog.people.set({
        email: user.primaryEmailAddress?.emailAddress,
        auth_type: "clerk",
        username: user.username,
        role: orgRole,
      });

      posthog.group("organization", organization.id, {
        name: organization?.name,
        slug: organization?.slug,
      });
    }

    if (!isSignedIn && posthog._isIdentified()) {
      posthog.reset();
    }
  }, [posthog, user, organization, orgRole, isSignedIn]);

  return null;
}
