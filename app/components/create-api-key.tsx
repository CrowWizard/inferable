"use client";

import { useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { client } from "@/client/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createErrorToast } from "@/lib/utils";
import toast from "react-hot-toast";
import { PlusIcon } from "lucide-react";

export function CreateApiKey({
  clusterId,
  onCreated,
}: {
  clusterId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const { getToken } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const loading = toast.loading("Creating API key...");

    try {
      const result = await client.createApiKey({
        headers: { authorization: `Bearer ${await getToken()}` },
        params: { clusterId },
        body: { name },
      });

      toast.dismiss(loading);

      if (result.status === 200) {
        toast.success("API key created successfully");
        setKey(result.body.key);
        onCreated();
      } else {
        createErrorToast(result, "Failed to create API key");
      }
    } catch (err) {
      toast.dismiss(loading);
      createErrorToast(err, "Failed to create API key");
    }
  };

  const handleClose = () => {
    setOpen(false);
    setName("");
    setKey(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create API Key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {key ? "Save your API Key" : "Create new API Key"}
          </DialogTitle>
        </DialogHeader>

        {key ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Make sure to copy your API key now. You won&apos;t be able to see
              it again!
            </div>
            <div className="p-4 bg-muted rounded-md font-mono text-sm break-all">
              {key}
            </div>
            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a name for your API key"
                required
              />
            </div>
            <Button type="submit" className="w-full">
              <PlusIcon className="w-4 h-4 mr-2" />
              Create
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
