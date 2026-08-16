import {
  Client,
  StreamableHTTPClientTransport,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ChatMessage, ITool } from "@jbcbdse/charlie-core";
import { mcpPromptToChatMessages } from "./mcp-content";
import { McpTool } from "./mcp-tool";
import type {
  McpPrompt,
  McpResource,
  McpResourceContents,
  McpResourceTemplate,
  McpServerConfig,
  McpTransportConfig,
} from "./types";

export class McpSession {
  private static readonly clientInfo = { name: "charlie", version: "0.4.0" };

  private constructor(
    public readonly name: string,
    private readonly client: Client,
    private readonly cachedTools: ITool[],
  ) {}

  public static async connect(config: McpServerConfig): Promise<McpSession> {
    const client = new Client(McpSession.clientInfo);
    await client.connect(McpSession.createTransport(config.transport));
    return McpSession.fromClient(config.name, client, {
      toolNamePrefix: config.toolNamePrefix,
    });
  }

  public static async fromClient(
    name: string,
    client: Client,
    options?: { toolNamePrefix?: string },
  ): Promise<McpSession> {
    const { tools } = await client.listTools();
    const prefix = McpSession.defaultPrefix(name, options?.toolNamePrefix);
    return new McpSession(
      name,
      client,
      tools.map((tool) => new McpTool(client, tool, prefix)),
    );
  }

  public tools(): ITool[] {
    return this.cachedTools;
  }

  public instructions(): string | undefined {
    return this.client.getInstructions();
  }

  public async listResources(): Promise<{ resources: McpResource[] }> {
    const { resources } = await this.client.listResources();
    return {
      resources: resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
    };
  }

  public async listResourceTemplates(): Promise<{
    resourceTemplates: McpResourceTemplate[];
  }> {
    const { resourceTemplates } = await this.client.listResourceTemplates();
    return {
      resourceTemplates: resourceTemplates.map((template) => ({
        uriTemplate: template.uriTemplate,
        name: template.name,
        description: template.description,
        mimeType: template.mimeType,
      })),
    };
  }

  public async readResource(
    uri: string,
  ): Promise<{ contents: McpResourceContents[] }> {
    const { contents } = await this.client.readResource({ uri });
    return {
      contents: contents.map((item) => ({
        uri: item.uri,
        mimeType: item.mimeType,
        text: "text" in item ? item.text : undefined,
        blob: "blob" in item ? item.blob : undefined,
      })),
    };
  }

  public async listPrompts(): Promise<{ prompts: McpPrompt[] }> {
    const { prompts } = await this.client.listPrompts();
    return {
      prompts: prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      })),
    };
  }

  public async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<ChatMessage[]> {
    const result = await this.client.getPrompt({
      name,
      arguments: args,
    });
    return mcpPromptToChatMessages(result.messages);
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private static createTransport(config: McpTransportConfig): Transport {
    if (config.type === "stdio") {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        stderr: "pipe",
      });
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }

  private static defaultPrefix(name: string, toolNamePrefix?: string): string {
    return toolNamePrefix === undefined ? `${name}__` : toolNamePrefix;
  }
}
