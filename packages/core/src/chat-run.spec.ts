import { ChatRunGenerator } from "./chat-run";
import { EventName, EventProducer } from "./event-producer";
import { ChatAgentGetResponseOutput } from "./types";

const emptyResult: ChatAgentGetResponseOutput = {
  responseMessage: { role: "assistant", content: "" },
  responseMessages: [{ role: "assistant", content: "" }],
};

function emitText(producer: EventProducer, runId: string, text: string): void {
  producer.emit(EventName.ChatStreamChunk, {
    context: {
      runId,
      modelId: "m",
      messages: [],
      tools: [],
      mustCallTool: false,
      meta: {},
      eventProducer: producer,
    },
    modelId: "m",
    modelProvider: "p",
    chunk: { type: "text", text },
  });
}

describe("ChatRunGenerator", () => {
  it("does not start work until the next microtask", async () => {
    const producer = new EventProducer();
    let started = false;
    const run = new ChatRunGenerator(producer, "run", async () => {
      started = true;
      return emptyResult;
    }).create();
    expect(started).toBe(false);
    await run;
    expect(started).toBe(true);
  });

  it("is thenable and returns the work result", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(producer, "run", async () => ({
      responseMessage: { role: "assistant", content: "Hello" },
      responseMessages: [{ role: "assistant", content: "Hello" }],
    })).create();
    expect(typeof run.then).toBe("function");
    await expect(run).resolves.toMatchObject({
      responseMessage: { role: "assistant", content: "Hello" },
    });
  });

  it("scopes .on listeners to the runId", async () => {
    const producer = new EventProducer();
    const heardA: string[] = [];
    const heardB: string[] = [];
    const runA = new ChatRunGenerator(producer, "a", async () => {
      emitText(producer, "a", "A1");
      emitText(producer, "other", "leak");
      emitText(producer, "a", "A2");
      return emptyResult;
    }).create();
    const runB = new ChatRunGenerator(producer, "b", async () => {
      emitText(producer, "b", "B1");
      return emptyResult;
    }).create();
    runA.on(EventName.ChatStreamChunk, ({ chunk }) => {
      if (chunk.type === "text") heardA.push(chunk.text);
    });
    runB.on(EventName.ChatStreamChunk, ({ chunk }) => {
      if (chunk.type === "text") heardB.push(chunk.text);
    });
    await Promise.all([runA, runB]);
    expect(heardA).toEqual(["A1", "A2"]);
    expect(heardB).toEqual(["B1"]);
  });

  it("async-iterates chunks then stops", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(producer, "run", async () => {
      emitText(producer, "run", "one");
      emitText(producer, "run", "two");
      return {
        responseMessage: { role: "assistant", content: "onetwo" },
        responseMessages: [{ role: "assistant", content: "onetwo" }],
      };
    }).create();
    const texts: string[] = [];
    for await (const { chunk } of run) {
      if (chunk.type === "text") texts.push(chunk.text);
    }
    expect(texts).toEqual(["one", "two"]);
    await expect(run).resolves.toMatchObject({
      responseMessage: { role: "assistant", content: "onetwo" },
    });
  });

  it("does not reject the run when a listener throws", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(producer, "run", async () => {
      emitText(producer, "run", "ok");
      return {
        responseMessage: { role: "assistant", content: "ok" },
        responseMessages: [{ role: "assistant", content: "ok" }],
      };
    }).create();
    run.on(EventName.ChatStreamChunk, () => {
      throw new Error("consumer fault");
    });
    await expect(run).resolves.toMatchObject({
      responseMessage: { role: "assistant", content: "ok" },
    });
  });

  it("replaces a duplicate .on registration instead of leaking", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(producer, "run", async () => {
      emitText(producer, "run", "x");
      return emptyResult;
    }).create();
    const heard: string[] = [];
    const listener = (): void => {
      heard.push("hit");
    };
    run.on(EventName.ChatStreamChunk, listener);
    run.on(EventName.ChatStreamChunk, listener);
    await run;
    expect(heard).toEqual(["hit"]);
    expect(producer.emitter.listenerCount(EventName.ChatStreamChunk)).toBe(0);
  });

  it("ignores .on after the run settles", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(
      producer,
      "run",
      async () => emptyResult,
    ).create();
    await run;
    run.on(EventName.ChatStreamChunk, () => undefined);
    expect(producer.emitter.listenerCount(EventName.ChatStreamChunk)).toBe(0);
  });

  it("async iterator throws when the run rejects with undefined", async () => {
    const producer = new EventProducer();
    const run = new ChatRunGenerator(producer, "run", () =>
      Promise.reject(undefined),
    ).create();
    await expect(
      (async () => {
        for await (const event of run) {
          void event;
        }
      })(),
    ).rejects.toBeUndefined();
  });
});
