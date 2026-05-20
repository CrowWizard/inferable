"use client";

import { client } from "@/client/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createErrorToast } from "@/lib/utils";
import { useAuth } from "@/lib/use-auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { Loading } from "@/components/loading";

const formSchema = z.object({
  secretKey: z.string().min(1, "API key is required"),
  publicKey: z.string().min(1, "Public key is required"),
  baseUrl: z.string().min(1, "Base URL is required"),
  sendMessagePayloads: z
    .boolean()
    .describe(
      "Send all message payloads or just the LLM metadata? (LLM metadata includes the LLM response, tokens, and latency)",
    )
    .default(false),
});

export default function LangfuseIntegration({
  params: { clusterId },
}: {
  params: { clusterId: string };
}) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      secretKey: "",
      publicKey: "",
      baseUrl: "",
      sendMessagePayloads: false,
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const response = await client.upsertIntegrations({
      headers: {
        authorization: `Bearer ${await getToken()}`,
      },
      params: {
        clusterId: clusterId,
      },
      body: {
        langfuse: {
          secretKey: data.secretKey,
          publicKey: data.publicKey,
          baseUrl: data.baseUrl,
          sendMessagePayloads: data.sendMessagePayloads,
        },
      },
    });

    if (response.status === 200) {
      toast.success("Integration updated");
      await fetchConfig();
      return;
    } else {
      createErrorToast(response, "Failed to update integration");
    }
  };

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    const response = await client.getIntegrations({
      headers: {
        authorization: `Bearer ${await getToken()}`,
      },
      params: {
        clusterId: clusterId,
      },
    });
    setLoading(false);

    if (response.status === 200) {
      const result = z
        .object({
          secretKey: z.string(),
          publicKey: z.string(),
          baseUrl: z.string(),
          sendMessagePayloads: z.boolean(),
        })
        .safeParse(response.body?.langfuse);

      if (result.success) {
        form.setValue("secretKey", result.data.secretKey);
        form.setValue("publicKey", result.data.publicKey);
        form.setValue("baseUrl", result.data.baseUrl);
        form.setValue("sendMessagePayloads", result.data.sendMessagePayloads);
      }
    }
  }, [clusterId, getToken, form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/clusters/${clusterId}/integrations`}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to integrations
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">📊</span>
            <CardTitle>Configure Langfuse</CardTitle>
          </div>
          <CardDescription>
            Connect your Langfuse account to send LLM telemetry data for
            monitoring and analytics. You can find your API keys in your
            Langfuse dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="secretKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Secret API Key</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormDescription>
                      Your Langfuse secret API key
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="publicKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public Key</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>Your Langfuse public key</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base URL</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      Langfuse API base URL. For US region, use{" "}
                      <code>https://us.cloud.langfuse.com</code>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sendMessagePayloads"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Send Message Payloads</FormLabel>
                    <FormControl className="flex items-center gap-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      {field.value
                        ? "Inferable will send all metadata and payloads for every LLM call"
                        : "Inferable will only send LLM metadata like token count and latency"}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit">Save Configuration</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
