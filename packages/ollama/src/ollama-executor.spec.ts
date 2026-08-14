import { OpenAiChatExecutorOptions } from "@jbcbdse/charlie-openai";
import { OllamaExecutor } from "./ollama-executor";

function resolvedOptions(executor: OllamaExecutor): OpenAiChatExecutorOptions {
  return (executor as unknown as { options: OpenAiChatExecutorOptions })
    .options;
}

function client(executor: OllamaExecutor): { baseURL: string } {
  return (executor as unknown as { openAiClient: { baseURL: string } })
    .openAiClient;
}

describe("OllamaExecutor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults modelProvider, modelId, baseURL, and apiKey", () => {
    const executor = new OllamaExecutor();
    expect(executor.modelProvider).toBe("ollama");
    expect(executor.modelId).toBe("qwen3.6:35b-a3b");
    expect(resolvedOptions(executor).baseURL).toBe("http://localhost:11434/v1");
    expect(resolvedOptions(executor).apiKey).toBe("ollama");
    expect(client(executor).baseURL).toBe("http://localhost:11434/v1");
  });

  it("uses OLLAMA_BASE_URL and OLLAMA_API_KEY from env", () => {
    process.env.OLLAMA_BASE_URL = "http://remote:11434/v1";
    process.env.OLLAMA_API_KEY = "env-key";
    const executor = new OllamaExecutor();
    expect(resolvedOptions(executor).baseURL).toBe("http://remote:11434/v1");
    expect(resolvedOptions(executor).apiKey).toBe("env-key");
    expect(client(executor).baseURL).toBe("http://remote:11434/v1");
  });

  it("falls through empty-string env to localhost defaults", () => {
    process.env.OLLAMA_BASE_URL = "";
    process.env.OLLAMA_API_KEY = "";
    const executor = new OllamaExecutor();
    expect(resolvedOptions(executor).baseURL).toBe("http://localhost:11434/v1");
    expect(resolvedOptions(executor).apiKey).toBe("ollama");
    expect(client(executor).baseURL).toBe("http://localhost:11434/v1");
  });

  it("prefers explicit constructor options over env", () => {
    process.env.OLLAMA_BASE_URL = "http://env:11434/v1";
    process.env.OLLAMA_API_KEY = "env-key";
    const executor = new OllamaExecutor({
      modelId: "llama3.2",
      modelProvider: "custom-ollama",
      baseURL: "http://explicit:11434/v1",
      apiKey: "explicit",
    });
    expect(executor.modelId).toBe("llama3.2");
    expect(executor.modelProvider).toBe("custom-ollama");
    expect(resolvedOptions(executor).baseURL).toBe("http://explicit:11434/v1");
    expect(resolvedOptions(executor).apiKey).toBe("explicit");
    expect(client(executor).baseURL).toBe("http://explicit:11434/v1");
  });
});
