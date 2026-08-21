import { serveCharlieMcpStdio } from "../stdio";
import { EchoTool, FailingTool } from "./echo-tool";

serveCharlieMcpStdio([new EchoTool(), new FailingTool()], {
  name: "charlie-mcp-server-fixture",
  version: "0.0.0",
});
