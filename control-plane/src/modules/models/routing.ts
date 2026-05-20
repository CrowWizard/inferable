import { env } from "../../utilities/env";
import OpenAI from "openai";
import { logger } from "../observability/logger";
import { BedrockCohereEmbeddings } from "../embeddings/bedrock-cohere-embeddings";
import { CohereEmbeddings } from "@langchain/cohere";

export const CONTEXT_WINDOW: Record<string, number> = {
  "deepseek-v4-flash": 128_000,
  "dedeepseek-v4-pro": 128_000,
  "qwen-plus": 131_072,
  "qwen-turbo": 1_000_000,
  "qwen-max": 32_768,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
};

const routingOptions = {
  "deepseek-v4-flash": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "deepseek-v4-flash",
            beta: false,
          },
        ]
      : []),
  ],
  "deepseek-v4-pro": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "deepseek-v4-pro",
            beta: false,
          },
        ]
      : []),
  ],
  "qwen-plus": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "qwen-plus",
            beta: false,
          },
        ]
      : []),
  ],
  "qwen-turbo": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "qwen-turbo",
            beta: false,
          },
        ]
      : []),
  ],
  "qwen-max": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "qwen-max",
            beta: false,
          },
        ]
      : []),
  ],
  "gpt-4o": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "gpt-4o",
            beta: false,
          },
        ]
      : []),
  ],
  "gpt-4o-mini": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "gpt-4o-mini",
            beta: false,
          },
        ]
      : []),
  ],
  "gpt-4.1": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "gpt-4.1",
            beta: false,
          },
        ]
      : []),
  ],
  "gpt-4.1-mini": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "gpt-4.1-mini",
            beta: false,
          },
        ]
      : []),
  ],
  "gpt-4.1-nano": [
    ...(env.OPENAI_API_KEY
      ? [
          {
            buildClient: () => buildOpenAIClient(),
            modelId: "gpt-4.1-nano",
            beta: false,
          },
        ]
      : []),
  ],
};



const embeddingOptions = {
  "BAAI/bge-m3": [
    ...(env.SILICONFLOW_API_KEY
      ? [
          {
            buildClient: () => buildSiliconFlowClient(),
            modelId: "BAAI/bge-m3",
            beta: false,
          },
        ]
      : []),
  ],
};

export type ChatIdentifiers = keyof typeof routingOptions;
export const isChatIdentifier = (identifier: string): identifier is ChatIdentifiers => {
  return identifier in routingOptions;
};
export type EmbeddingIdentifiers = keyof typeof embeddingOptions;
export const isEmbeddingIdentifier = (identifier: string): identifier is EmbeddingIdentifiers => {
  return identifier in embeddingOptions;
};

export const getRouting = ({
  identifier,
  index,
}: {
  identifier: ChatIdentifiers;
  index: number;
}) => {
  if (index >= routingOptions[identifier].length) {
    logger.warn("Routing index out of bounds", {
      identifier,
      index,
    });
    index = index % routingOptions[identifier].length;
  }

  const routing = routingOptions[identifier][index];

  return routing;
};

export const getEmbeddingRouting = ({
  identifier,
  index,
}: {
  identifier: EmbeddingIdentifiers;
  index: number;
}) => {
  if (index >= embeddingOptions[identifier].length) {
    logger.warn("Routing index out of bounds", {
      identifier,
      index,
    });
    index = index % embeddingOptions[identifier].length;
  }

  const routing = embeddingOptions[identifier][index];

  return routing;
};

const buildOpenAIClient = () => {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });
};

const buildSiliconFlowClient = () => {
  if (!env.SILICONFLOW_API_KEY) {
    throw new Error("Missing SILICONFLOW_API_KEY");
  }

  return new OpenAI({
    apiKey: env.SILICONFLOW_API_KEY,
    baseURL: env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
  });
};

export const start = () => {
  for (const [key, value] of Object.entries(routingOptions)) {
    if (value.length === 0) {
      throw new Error(`No provider available for ${key}`);
    } else {
      logger.info(`Provider available for ${key}`, { value });
    }
  }

  for (const [key, value] of Object.entries(embeddingOptions)) {
    if (value.length === 0) {
      logger.warn(`No provider available for ${key}. Set SILICONFLOW_API_KEY to enable embeddings.`);
    } else {
      logger.info(`Provider available for ${key}`, {
        value,
      });
    }
  }
};
