import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventName,
  EventProducer,
  type ChatAgentContext,
} from "@jbcbdse/charlie-core";
import { McpSession } from "./mcp-session";
import { McpSessions } from "./mcp-sessions";
import type { McpServerConfig } from "./types";

const nodeRequire = createRequire(__filename);

function everythingEntry(): string {
  return nodeRequire.resolve(
    "@modelcontextprotocol/server-everything/dist/index.js",
  );
}

function everythingStdio(name = "everything"): McpServerConfig {
  return {
    name,
    transport: {
      type: "stdio",
      command: process.execPath,
      args: [everythingEntry(), "stdio"],
    },
  };
}

function shellExec(command: string, args: string[]): string {
  return `${[command, ...args].map((part) => JSON.stringify(part)).join(" ")}`;
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process ${pid} still running`);
}

function mockContext(producer = new EventProducer()): ChatAgentContext {
  return {
    runId: "run",
    modelId: "mock",
    messages: [],
    meta: {},
    eventProducer: producer,
  };
}

describe("server-everything over stdio", () => {
  let mcp: McpSessions;

  beforeAll(async () => {
    mcp = await McpSessions.connect([everythingStdio()]);
  });

  afterAll(async () => {
    await mcp.close();
  });

  it("exposes echo and get-sum as ITools", async () => {
    const names = mcp.tools().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["everything__echo", "everything__get-sum"]),
    );
    const echo = mcp.tools().find((tool) => tool.name === "everything__echo");
    const sum = mcp.tools().find((tool) => tool.name === "everything__get-sum");
    await expect(
      echo?.handle({ message: "charlie" }, mockContext()),
    ).resolves.toEqual(expect.stringContaining("charlie"));
    await expect(sum?.handle({ a: 2, b: 3 }, mockContext())).resolves.toEqual(
      expect.stringContaining("5"),
    );
  });

  it("forwards progress notifications", async () => {
    const producer = new EventProducer();
    const progress: string[] = [];
    producer.emitter.on(EventName.ToolProgress, (event) => {
      progress.push(event.message);
    });
    const tool = mcp
      .tools()
      .find(
        (item) => item.name === "everything__trigger-long-running-operation",
      );
    await tool?.handle({ duration: 0.4, steps: 2 }, mockContext(producer));
    expect(progress.length).toBeGreaterThan(0);
  });

  it("lists and reads static resources", async () => {
    const { resources } = await mcp.listResources("everything");
    const doc = resources.find((resource) =>
      resource.uri.startsWith("demo://resource/static/document/"),
    );
    expect(doc).toBeDefined();
    const { contents } = await mcp.readResource("everything", doc?.uri ?? "");
    expect(contents[0]?.text).toEqual(expect.any(String));
    expect(contents[0]?.text?.length).toBeGreaterThan(0);
  });

  it("reads a templated dynamic resource", async () => {
    const { resourceTemplates } = await mcp.listResourceTemplates("everything");
    expect(
      resourceTemplates.some((template) =>
        template.uriTemplate.includes("demo://resource/dynamic/text/"),
      ),
    ).toBe(true);
    const { contents } = await mcp.readResource(
      "everything",
      "demo://resource/dynamic/text/1",
    );
    expect(contents[0]?.text).toEqual(expect.any(String));
    expect(contents[0]?.text?.length).toBeGreaterThan(0);
  });

  it("returns ChatMessages from prompts", async () => {
    const { prompts } = await mcp.listPrompts("everything");
    expect(prompts.map((prompt) => prompt.name)).toEqual(
      expect.arrayContaining(["simple-prompt", "args-prompt"]),
    );
    const simple = await mcp.getPrompt("everything", "simple-prompt");
    expect(simple[0]?.role).toBe("user");
    if (simple[0]?.role !== "user") {
      throw new Error("expected user message");
    }
    expect(simple[0].content.length).toBeGreaterThan(0);
    const withArgs = await mcp.getPrompt("everything", "args-prompt", {
      city: "Austin",
      state: "TX",
    });
    if (withArgs[0]?.role !== "user") {
      throw new Error("expected user message");
    }
    expect(withArgs[0].content).toEqual(expect.stringContaining("Austin"));
    expect(withArgs[0].content).toEqual(expect.stringContaining("TX"));
  });
});

describe("stdio lifecycle", () => {
  it("connects after a large stderr burst from a non-Node child", async () => {
    let timeout: NodeJS.Timeout | undefined;
    const session = await Promise.race([
      McpSession.connect({
        name: "noisy",
        transport: {
          type: "stdio",
          command: "sh",
          args: [
            "-c",
            `head -c 200000 /dev/zero | tr '\\0' 'x' >&2; exec ${shellExec(process.execPath, [everythingEntry(), "stdio"])}`,
          ],
        },
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("stderr pipe deadlock")),
          8000,
        );
      }),
    ]);
    clearTimeout(timeout);
    try {
      expect(session.tools().some((tool) => tool.name.endsWith("echo"))).toBe(
        true,
      );
    } finally {
      await session.close();
    }
  });

  it("closes already-connected servers when another connect fails", async () => {
    const pidFile = join(tmpdir(), `charlie-mcp-orphan-${process.pid}.txt`);
    try {
      await expect(
        McpSessions.connect([
          {
            name: "good",
            transport: {
              type: "stdio",
              command: "sh",
              args: [
                "-c",
                `echo $$ > ${JSON.stringify(pidFile)}; exec ${shellExec(process.execPath, [everythingEntry(), "stdio"])}`,
              ],
            },
          },
          {
            name: "bad",
            transport: { type: "http", url: "http://127.0.0.1:1/mcp" },
          },
        ]),
      ).rejects.toThrow();
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(pid).toBeGreaterThan(0);
      await expectProcessGone(pid);
    } finally {
      try {
        unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }
  });
});

describe("server-everything over Streamable HTTP", () => {
  let child: ChildProcess | undefined;
  let session: McpSession | undefined;
  const port = 18000 + Math.floor(Math.random() * 2000);

  beforeAll(async () => {
    child = spawn(process.execPath, [everythingEntry(), "streamableHttp"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("everything HTTP server did not start"));
      }, 20000);
      const onData = (buf: Buffer) => {
        if (String(buf).includes(`listening on port ${port}`)) {
          clearTimeout(timeout);
          child?.stderr?.off("data", onData);
          resolve();
        }
      };
      child?.stderr?.on("data", onData);
      child?.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    session = await McpSession.connect({
      name: "everything",
      transport: { type: "http", url: `http://127.0.0.1:${port}/mcp` },
    });
  });

  afterAll(async () => {
    try {
      await session?.close();
    } finally {
      child?.kill("SIGTERM");
    }
  });

  it("calls echo over HTTP", async () => {
    const echo = session
      ?.tools()
      .find((tool) => tool.name === "everything__echo");
    await expect(
      echo?.handle({ message: "http" }, mockContext()),
    ).resolves.toEqual(expect.stringContaining("http"));
  });
});
