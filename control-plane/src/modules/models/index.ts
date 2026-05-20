import AsyncRetry from "async-retry";
import { JsonSchema7Type } from "zod-to-json-schema";
import OpenAI from "openai";
import {
  ChatIdentifiers,
  CONTEXT_WINDOW,
  EmbeddingIdentifiers,
  getEmbeddingRouting,
  getRouting,
  isChatIdentifier,
  isEmbeddingIdentifier,
} from "./routing";
import { isRetryableError } from "../../utilities/errors";
import { logger } from "../observability/logger";
import * as events from "../observability/events";
import { addAttributes } from "../observability/tracer";
import { rateLimiter } from "../../utilities/rate-limiter";
import { trackCustomerTelemetry } from "../customer-telemetry/track";

type CallInput = {
  system?: string | undefined;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
};

type CallOutput = {
  raw: OpenAI.Chat.Completions.ChatCompletion;
};

type StructuredCallInput = CallInput & {
  schema: JsonSchema7Type;
};

type StructuredCallOutput = CallOutput & {
  structured: unknown;
};

export type Model = {
  call: (options: CallInput) => Promise<CallOutput>;
  structured: <T extends StructuredCallInput>(
    options: T,
  ) => Promise<StructuredCallOutput>;
  identifier: ChatIdentifiers | EmbeddingIdentifiers;
  contextWindow?: number;
  embedQuery: (input: string) => Promise<number[]>;
};

const perClusterRateLimiters = [
  rateLimiter({ window: "minute", ceiling: 200_000 * 4 }), // roughly 200k tokens per minute
  rateLimiter({ window: "hour", ceiling: 2_000_000 * 4 }), // roughly 2 million tokens per hour
];

export const buildModel = ({
  identifier,
  trackingOptions,
  modelOptions,
  purpose,
  provider,
}: {
  identifier: ChatIdentifiers | EmbeddingIdentifiers;
  trackingOptions?: {
    clusterId?: string;
    runId?: string;
  };
  modelOptions?: {
    temperature?: number;
  };
  purpose?: string;
  provider?: {
    url?: string;
    model?: string;
    key?: string;
  };
}): Model => {
  const temperature = modelOptions?.temperature ?? 0.5;

  return {
    identifier,
    contextWindow: CONTEXT_WINDOW[identifier],
    embedQuery: async (input: string) => {
      if (!isEmbeddingIdentifier(identifier)) {
        throw new Error(`${identifier} is not an embedding model`);
      }
      const routing = getEmbeddingRouting({
        identifier,
        index: 0,
      });

      if (!routing) {
        throw new Error("Could not get model routing");
      }

      const client = routing.buildClient();
      const modelId = routing.modelId;

      const response = await client.embeddings.create({
        model: modelId,
        input: input,
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        throw new Error("Embedding API returned no data");
      }

      return embedding;
    },
    call: async (options: CallInput) => {
      if (!isChatIdentifier(identifier)) {
        throw new Error(`${identifier} is not a chat model`);
      }
      const response = await AsyncRetry(
        async (bail, attempt) => {
          let client: OpenAI = new OpenAI({
            apiKey: provider?.key,
            baseURL: provider?.url,
          });
          let modelId = provider?.model;

          const demoRouting = getRouting({
            identifier,
            index: attempt - 1,
          });

          if (!provider) {
            client = demoRouting?.buildClient();
            modelId = demoRouting?.modelId;
          }

          if (!client || !modelId) {
            bail(new Error("Could not get model routing"));
            return;
          }

          if (trackingOptions?.clusterId) {
            const clusterId = trackingOptions.clusterId;

            const allowed = await Promise.all(
              perClusterRateLimiters.map(r =>
                r.allowed(
                  clusterId,
                  Buffer.byteLength(JSON.stringify(options.messages)),
                ),
              ),
            );

            if (!allowed.every(Boolean)) {
              logger.warn(
                "Rate limit exceeded. (Just logged, not preventing request)",
                {
                  modelId: identifier,
                  clusterId,
                  allowed,
                },
              );
            }
          }

          const tools: OpenAI.Chat.Completions.ChatCompletionTool[] =
            options.tools ?? [];

          // Build OpenAI messages from system + messages
          const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            [];

          if (options.system) {
            openaiMessages.push({
              role: "system",
              content: options.system,
            });
          }

          openaiMessages.push(...options.messages);

          try {
            const startedAt = Date.now();
            const response = await client.chat.completions.create({
              model: modelId,
              temperature,
              max_tokens: options.maxTokens ?? 2048,
              messages: openaiMessages,
              tools: tools.length > 0 ? tools : undefined,
            });

            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            trackModelUsage({
              clusterId: trackingOptions?.clusterId,
              runId: trackingOptions?.runId,
              modelId,
              systemPrompt: options.system,
              tools,
              inputTokens: response.usage?.prompt_tokens,
              outputTokens: response.usage?.completion_tokens,
              temperature,
              input: options.messages,
              output: response.choices,
              startedAt,
              completedAt: Date.now(),
            });

            return response;
          } catch (error) {
            await handleErrror({
              bail,
              error,
              modelId: identifier,
              attempt,
            });
          }
        },
        {
          retries: 5,
        },
      );

      if (!response) {
        throw new Error("Model did not return output");
      }

      return {
        raw: response,
      };
    },
    structured: async <T extends StructuredCallInput>(options: T) => {
      if (!isChatIdentifier(identifier)) {
        throw new Error(`${identifier} is not a chat model`);
      }

      const response = await AsyncRetry(
        async (bail, attempt) => {
          let client: OpenAI = new OpenAI({
            apiKey: provider?.key,
            baseURL: provider?.url,
          });
          let modelId = provider?.model;

          const demoRouting = getRouting({
            identifier,
            index: attempt - 1,
          });

          if (!provider) {
            client = demoRouting?.buildClient();
            modelId = demoRouting?.modelId;
          }

          if (!client || !modelId) {
            bail(new Error("Could not get model routing"));
            return;
          }

          const tools: OpenAI.Chat.Completions.ChatCompletionTool[] =
            options.tools ?? [];

          // Build OpenAI messages from system + messages
          const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            [];

          if (options.system) {
            openaiMessages.push({
              role: "system",
              content: options.system,
            });
          }

          openaiMessages.push(...options.messages);

          try {
            const startedAt = Date.now();
            const response = await client.chat.completions.create({
              model: modelId,
              temperature,
              max_tokens: options.maxTokens ?? 2048,
              messages: openaiMessages,
              tool_choice: {
                type: "function",
                function: { name: "extract" },
              },
              tools: [
                ...tools,
                {
                  type: "function",
                  function: {
                    name: "extract",
                    parameters: options.schema as Record<string, unknown>,
                  },
                },
              ],
            });

            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            trackModelUsage({
              ...trackingOptions,
              modelId,
              inputTokens: response.usage?.prompt_tokens,
              outputTokens: response.usage?.completion_tokens,
              temperature,
              input: options.messages,
              output: response.choices,
              startedAt,
              completedAt: Date.now(),
              purpose,
            });

            return response;
          } catch (error) {
            await handleErrror({
              bail,
              error,
              modelId,
              attempt,
            });
          }
        },
        {
          retries: 5,
        },
      );

      if (!response) {
        throw new Error("Model did not return output");
      }

      return parseStructuredResponse({ response });
    },
  };
};

const handleErrror = async ({
  bail,
  error,
  modelId,
  attempt,
}: {
  bail: (e: unknown) => void;
  error: unknown;
  modelId: string;
  attempt: number;
}) => {
  if (!isRetryableError(error)) {
    logger.error("Model call failed with non-retryable error", {
      modelId,
      attempt,
      error,
    });
    bail(error);
    return;
  }

  logger.warn("Model call failed with retryable error", {
    modelId,
    attempt,
    error,
  });

  await new Promise(resolve => setTimeout(resolve, attempt * 500));
  throw error;
};

const parseStructuredResponse = ({
  response,
}: {
  response: OpenAI.Chat.Completions.ChatCompletion;
}): Awaited<ReturnType<Model["structured"]>> => {
  const choice = response.choices[0];
  const message = choice?.message;

  if (!message?.tool_calls || message.tool_calls.length === 0) {
    throw new Error("Model did not return structured output (no tool_calls)");
  }

  const extractCall = message.tool_calls.find(
    call => call.function.name === "extract",
  );

  if (!extractCall) {
    throw new Error("Model did not return structured output (no extract call)");
  }

  let structured: unknown;
  try {
    structured = JSON.parse(extractCall.function.arguments);
  } catch {
    throw new Error("Model returned invalid JSON in structured output");
  }

  return {
    raw: response,
    structured,
  };
};

export const buildMockModel = ({
  mockResponses,
  responseCount,
}: {
  mockResponses: string[];
  responseCount: number;
}): Model => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    identifier: "mock" as any,
    embedQuery: async () => {
      throw new Error("Not implemented");
    },
    call: async () => {
      throw new Error("Not implemented");
    },
    structured: async () => {
      if (responseCount >= mockResponses.length) {
        throw new Error("Mock model ran out of responses");
      }

      const data = JSON.parse(mockResponses[responseCount]);

      // Sleep for between 500 and 1500 ms
      await new Promise(resolve =>
        setTimeout(resolve, Math.random() * 1000 + 500),
      );

      return {
        raw: { choices: [] } as unknown as OpenAI.Chat.Completions.ChatCompletion,
        structured: data,
      };
    },
  };
};

const trackModelUsage = async ({
  runId,
  clusterId,
  modelId,
  inputTokens,
  outputTokens,
  temperature,
  input,
  output,
  startedAt,
  completedAt,
  purpose,
  systemPrompt,
  tools,
}: {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  temperature: number;
  input: unknown;
  output: unknown;
  startedAt: number;
  completedAt: number;
  purpose?: string;
  clusterId?: string;
  runId?: string;
  systemPrompt?: string;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
}) => {
  if (!clusterId) {
    logger.warn("No cluster id provided, usage tracking will be skipped", {
      modelId,
      workflowId: runId,
    });
    return;
  }

  logger.info("Model usage", {
    modelId,
    inputTokens,
    outputTokens,
  });

  addAttributes({
    "model.input_tokens": inputTokens,
    "model.output_tokens": outputTokens,
  });

  events.write({
    type: "modelInvoked",
    clusterId: clusterId,
    runId: runId,
    tokenUsageInput: inputTokens,
    tokenUsageOutput: outputTokens,
    modelId,
    meta: {
      purpose,
      systemPrompt,
      input: input,
      output: output,
      temperature,
      tools,
    },
  });

  if (runId) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    trackCustomerTelemetry({
      type: "modelCall",
      clusterId,
      runId,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      model: modelId,
      temperature: temperature,
      startedAt,
      completedAt,
      input,
      output,
      purpose,
    });
  }
};
