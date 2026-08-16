export interface McpStdioTransportConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpTransportConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpTransportConfig =
  | McpStdioTransportConfig
  | McpHttpTransportConfig;

export interface McpServerConfig {
  name: string;
  transport: McpTransportConfig;
  /**
   * Prefix applied to Charlie-facing tool names. Defaults to `${name}__`.
   * Pass `""` to use the server's native tool names.
   */
  toolNamePrefix?: string;
}

export interface McpConfigFileServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  toolNamePrefix?: string;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpConfigFileServer>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}
