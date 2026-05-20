"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/use-auth";
import { client } from "@/client/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative } from "date-fns";
import { CreateApiKey } from "@/components/create-api-key";
import { createErrorToast } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ApiKey = {
  id: string;
  name: string;
  createdAt: Date;
  createdBy: string;
  revokedAt: Date | null;
};

export function ApiKeys({ clusterId }: { clusterId: string }) {
  const { getToken } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  const fetchApiKeys = useCallback(async () => {
    try {
      const result = await client.listApiKeys({
        headers: { authorization: `Bearer ${await getToken()}` },
        params: { clusterId },
      });

      if (result.status === 200) {
        setApiKeys(result.body as ApiKey[]);
      } else {
        createErrorToast(result, "Failed to fetch API keys");
      }
    } catch (err) {
      createErrorToast(err, "Failed to fetch API keys");
    }
  }, [clusterId, getToken]);

  const handleRevoke = useCallback(
    async (keyId: string) => {
      try {
        await client.revokeApiKey({
          headers: { authorization: `Bearer ${await getToken()}` },
          params: { clusterId, keyId },
        });
        fetchApiKeys();
      } catch (err) {
        createErrorToast(err, "Failed to revoke API key");
      }
    },
    [clusterId, getToken, fetchApiKeys],
  );

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  return (
    <Card className="h-full overflow-y-scroll">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Create and manage API keys for your cluster.
          </CardDescription>
        </div>
        <CreateApiKey clusterId={clusterId} onCreated={fetchApiKeys} />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {apiKeys
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            )
            .map((apiKey) => (
              <div
                key={apiKey.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-background hover:bg-muted/50"
              >
                <div className="space-y-1">
                  <div className="font-medium">
                    {apiKey.name}
                    <span className="text-xs text-muted-foreground ml-2">
                      ({apiKey.id})
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Created{" "}
                    {formatRelative(new Date(apiKey.createdAt), new Date())}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge
                    variant={apiKey.revokedAt ? "destructive" : "default"}
                    className="capitalize"
                  >
                    {apiKey.revokedAt ? "Revoked" : "Active"}
                  </Badge>
                  {!apiKey.revokedAt && (
                    <Button
                      onClick={() => handleRevoke(apiKey.id)}
                      variant="destructive"
                      size="sm"
                      className="text-xs"
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          {apiKeys.length === 0 && (
            <div className="mb-6 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <p>
                API keys are used to authenticate machines (workers) with your
                cluster. Workers use these keys to:
              </p>
              <ul className="list-disc ml-6 mt-2 space-y-1">
                <li>Register functions that can be used in workflows</li>
                <li>Create and manage runs</li>
                <li>Report function execution results</li>
                <li>Report health metrics</li>
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
