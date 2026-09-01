import { OpenAiTextEmbeddingGenerator } from "@jbcbdse/charlie-openai";
import { OllamaTextEmbeddingGenerator } from "./ollama-text-embedding-generator";

function client(generator: OllamaTextEmbeddingGenerator): { baseURL: string } {
  return (
    generator as unknown as { openAiClient: { baseURL: string } }
  ).openAiClient;
}

describe("OllamaTextEmbeddingGenerator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults modelId, baseURL, and apiKey", () => {
    const generator = new OllamaTextEmbeddingGenerator();
    expect(generator).toBeInstanceOf(OpenAiTextEmbeddingGenerator);
    expect(generator.modelId).toBe("nomic-embed-text");
    expect(client(generator).baseURL).toBe("http://localhost:11434/v1");
  });

  it("uses OLLAMA_BASE_URL and OLLAMA_API_KEY from env", () => {
    process.env.OLLAMA_BASE_URL = "http://remote:11434/v1";
    process.env.OLLAMA_API_KEY = "env-key";
    const generator = new OllamaTextEmbeddingGenerator();
    expect(client(generator).baseURL).toBe("http://remote:11434/v1");
  });

  it("falls through empty-string env to localhost defaults", () => {
    process.env.OLLAMA_BASE_URL = "";
    process.env.OLLAMA_API_KEY = "";
    const generator = new OllamaTextEmbeddingGenerator();
    expect(client(generator).baseURL).toBe("http://localhost:11434/v1");
  });

  it("prefers explicit constructor options over env", () => {
    process.env.OLLAMA_BASE_URL = "http://env:11434/v1";
    process.env.OLLAMA_API_KEY = "env-key";
    const generator = new OllamaTextEmbeddingGenerator({
      modelId: "all-minilm",
      baseURL: "http://explicit:11434/v1",
      apiKey: "explicit",
    });
    expect(generator.modelId).toBe("all-minilm");
    expect(client(generator).baseURL).toBe("http://explicit:11434/v1");
  });
});
