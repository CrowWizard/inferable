"use client";

import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import toast from "react-hot-toast";

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <CliAuth />
    </div>
  );
}

function CliAuth() {
  const { getToken, orgId } = useAuth();

  const handleGetToken = async () => {
    const token = await getToken();

    if (!token) {
      toast.error("Failed to get token");
      return;
    }

    const url = new URL("http://localhost:9999");
    url.searchParams.append("token", token);
    window.location.href = url.toString();
  };

  return (
    <Card className="w-[800px]">
      <CardHeader>
        <CardTitle>CLI Authentication</CardTitle>
        <CardDescription>
          Confirm CLI authentication (self-hosted mode)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Organization: {orgId}
        </p>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <Button onClick={handleGetToken} className="w-full">
          Authenticate CLI
        </Button>
      </CardFooter>
    </Card>
  );
}
