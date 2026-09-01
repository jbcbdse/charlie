/* eslint-disable no-console */
import { OllamaTextEmbeddingGenerator } from "@jbcbdse/charlie-ollama";

jest.setTimeout(120_000);

const MODEL = "nomic-embed-text";

async function ollamaEmbeddingReady(): Promise<string | undefined> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return "Ollama not reachable at localhost:11434";
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const pulled = data.models?.some(
      (m) => m.name === MODEL || m.name.startsWith(`${MODEL}:`),
    );
    if (!pulled) {
      return `${MODEL} is not pulled (ollama pull ${MODEL})`;
    }
  } catch {
    return "Ollama not reachable at localhost:11434";
  }
  return undefined;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("OllamaTextEmbeddingGenerator e2e", () => {
  test("embeds text and ranks related sentences closer than unrelated ones", async () => {
    const skip = await ollamaEmbeddingReady();
    if (skip) {
      console.warn(`Skipping ollama embeddings e2e: ${skip}`);
      return;
    }

    const generator = new OllamaTextEmbeddingGenerator({ modelId: MODEL });
    const [cat, feline, physics] = await Promise.all([
      generator.getEmbedding({ text: "the cat sat on the mat" }),
      generator.getEmbedding({ text: "a feline rested on the rug" }),
      generator.getEmbedding({ text: "quantum chromodynamics" }),
    ]);

    expect(cat.modelId).toBe(MODEL);
    expect(cat.embedding.length).toBeGreaterThan(0);
    expect(cat.embedding).toHaveLength(feline.embedding.length);
    expect(cat.embedding.every((n) => Number.isFinite(n))).toBe(true);

    const related = cosine(cat.embedding, feline.embedding);
    const unrelated = cosine(cat.embedding, physics.embedding);
    expect(related).toBeGreaterThan(unrelated);
  });
});
