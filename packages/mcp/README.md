# @jbcbdse/charlie-mcp

MCP client adapter for Charlie. Tools become `ITool`s for `getResponse`. Resources and prompts stay caller APIs.

```ts
import { McpSessions } from "@jbcbdse/charlie-mcp";

const mcp = await McpSessions.connect([
  {
    name: "everything",
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
]);

await agent.getResponse({
  messages: history,
  tools: mcp.tools(),
});

const { resources } = await mcp.listResources("everything");
const { contents } = await mcp.readResource("everything", resources[0].uri);

const starter = await mcp.getPrompt("everything", "args-prompt", {
  city: "Austin",
  state: "TX",
});

await mcp.close();
```

MCP servers are trusted local processes: `MCP_CONFIG` runs whatever `command` you give it (`shell: false`). The SDK only forwards a small env allowlist plus explicit `env` keys — it does not expand `${VAR}`. Tool results, resource bodies, and prompt text are passed through to the model as-is.

Out of scope: OAuth, elicitation, sampling, subscriptions, SSE fallback, and `tools/list_changed`. Images/audio flatten to placeholders because Charlie tool results are strings. For the reverse direction — exposing Charlie tools as an MCP server — see `@jbcbdse/charlie-mcp-server`.
