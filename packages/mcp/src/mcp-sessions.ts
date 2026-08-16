import type { ITool } from "@jbcbdse/charlie-core";
import { McpSession } from "./mcp-session";
import type { McpServerConfig } from "./types";

export class McpSessions {
  private constructor(
    private readonly sessionsByName: Map<string, McpSession>,
  ) {}

  public static async connect(
    configs: McpServerConfig[],
  ): Promise<McpSessions> {
    const seen = new Set<string>();
    for (const config of configs) {
      if (seen.has(config.name)) {
        throw new Error(`Duplicate MCP server name: ${config.name}`);
      }
      seen.add(config.name);
    }
    const results = await Promise.allSettled(
      configs.map((config) => McpSession.connect(config)),
    );
    const sessions = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      await Promise.allSettled(sessions.map((session) => session.close()));
      throw failure.reason;
    }
    return new McpSessions(
      new Map(sessions.map((session) => [session.name, session])),
    );
  }

  public session(name: string): McpSession {
    const session = this.sessionsByName.get(name);
    if (!session) {
      throw new Error(`Unknown MCP server: ${name}`);
    }
    return session;
  }

  public tools(): ITool[] {
    return [...this.sessionsByName.values()].flatMap((session) =>
      session.tools(),
    );
  }

  public listResources(serverName: string) {
    return this.session(serverName).listResources();
  }

  public listResourceTemplates(serverName: string) {
    return this.session(serverName).listResourceTemplates();
  }

  public readResource(serverName: string, uri: string) {
    return this.session(serverName).readResource(uri);
  }

  public listPrompts(serverName: string) {
    return this.session(serverName).listPrompts();
  }

  public getPrompt(
    serverName: string,
    name: string,
    args?: Record<string, string>,
  ) {
    return this.session(serverName).getPrompt(name, args);
  }

  public instructions(serverName: string): string | undefined {
    return this.session(serverName).instructions();
  }

  public async close(): Promise<void> {
    await Promise.allSettled(
      [...this.sessionsByName.values()].map((session) => session.close()),
    );
  }
}
