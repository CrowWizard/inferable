"use client";

import { useAuth, useUser } from "@/lib/use-auth";
import { useRollbarPerson } from "@rollbar/react";

export function RollbarUser() {
  const { user } = useUser();
  const { orgRole, orgId, orgSlug } = useAuth();

  useRollbarPerson({
    firstName: user?.firstName,
    lastName: user?.lastName,
    email:
      user?.emailAddresses.find((email) => email.emailAddress)?.emailAddress ??
      "",
    id: user?.id,
    organizationId: orgId,
    organizationName: orgSlug,
    organizationRole: orgRole,
  });

  return null;
}
