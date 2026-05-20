import { buildModel } from ".";
import { RetryableError } from "../../utilities/errors";
import { getRouting } from "./routing";

const mockCreate = jest.fn(() => ({
  usage: {
    prompt_tokens: 0,
    completion_tokens: 0,
  },
  choices: [
    {
      message: {
        content: "test",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "extract",
              arguments: "{}",
            },
          },
        ],
      },
    },
  ],
}));

jest.mock("./routing", () => ({
  ...jest.requireActual("./routing"),
  getRouting: jest.fn(() => ({
    buildClient: jest.fn(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    modelId: "modelId",
  })),
  isChatIdentifier: jest.fn(() => true),
  isEmbeddingIdentifier: jest.fn(() => false),
}));

describe("buildModel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("call", () => {
    it("should retry with RetryableError", async () => {
      mockCreate.mockImplementationOnce(() => {
        throw new RetryableError("");
      });

      const model = buildModel({
        identifier: "deepseek-v4-flash",
      });

      await model.call({
        messages: [],
      });

      expect(getRouting).toHaveBeenCalledTimes(2);

      expect(getRouting).toHaveBeenCalledWith({
        index: 0,
        identifier: "deepseek-v4-flash",
      });

      expect(getRouting).toHaveBeenCalledWith({
        index: 1,
        identifier: "deepseek-v4-flash",
      });
    });


    it("should not retry other errors", async () => {
      const error = new Error("");
      mockCreate.mockImplementationOnce(() => {
        throw error;
      });

      const model = buildModel({
        identifier: "deepseek-v4-flash",
      });

      await expect(
        async () =>
          await model.call({
            messages: [],
          }),
      ).rejects.toThrow(error);

      expect(getRouting).toHaveBeenCalledTimes(1);

      expect(getRouting).toHaveBeenCalledWith({
        index: 0,
        identifier: "deepseek-v4-flash",
      });
    });

    it.skip("should throw after exhausting retries", async () => {
      mockCreate.mockImplementation(() => {
        throw new RetryableError("");
      });

      const model = buildModel({
        identifier: "deepseek-v4-flash",
      });

      await expect(
        () => model.call({
          messages: [],
        })
      ).rejects.toThrow(RetryableError);

      expect(getRouting).toHaveBeenCalledTimes(6);

      expect(getRouting).toHaveBeenCalledWith({
        index: 0,
        identifier: "deepseek-v4-flash",
      });

      expect(getRouting).toHaveBeenCalledWith({
        index: 1,
        identifier: "deepseek-v4-flash",
      });

      expect(getRouting).toHaveBeenCalledWith({
        index: 2,
        identifier: "deepseek-v4-flash",
      });

      expect(getRouting).toHaveBeenCalledWith({
        index: 3,
        identifier: "deepseek-v4-flash",
      });

      expect(getRouting).toHaveBeenCalledWith({
        index: 4,
        identifier: "deepseek-v4-flash",
      });
    }, 60_000);
  });
});
