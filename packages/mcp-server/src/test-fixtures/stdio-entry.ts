import { CharlieMcpStdioServer } from "../charlie-mcp-stdio-server";
import { EchoTool, FailingTool } from "./echo-tool";

new CharlieMcpStdioServer({
  tools: [new EchoTool(), new FailingTool()],
  name: "charlie-mcp-server-fixture",
  version: "0.0.0",
}).serve();
