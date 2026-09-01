import {
  BaseTool,
  EventName,
  type ChatAgentContext,
  type ToolResult,
} from "@jbcbdse/charlie-core";
import { z } from "zod";

/** Simple round-trippable tool used across specs to exercise a real tools/call. */
export class EchoTool extends BaseTool {
  public name = "echo";
  public description = "Echoes the given message back.";
  public schema = z.object({
    message: z.string().describe("The message to echo back."),
  });
  public handler({ message }: z.infer<typeof this.schema>): string {
    return `echo: ${message}`;
  }
}

/** Always throws, to exercise the tools/call error path. */
export class FailingTool extends BaseTool {
  public name = "fail";
  public description = "Always fails. Used to test tool error handling.";
  public schema = z.object({});
  public handler(): string {
    throw new Error("this tool always fails");
  }
}

/** Returns context.meta as JSON, to exercise host-supplied meta. */
export class WhoAmITool extends BaseTool {
  public name = "whoami";
  public description = "Returns context.meta as JSON.";
  public schema = z.object({});
  public handler(
    _params: z.infer<typeof this.schema>,
    context: ChatAgentContext,
  ): string {
    return JSON.stringify(context.meta);
  }
}

/** Emits ToolProgress, then returns context.meta as JSON. */
export class ProgressTool extends BaseTool {
  public name = "progress";
  public description = "Emits ToolProgress, then returns context.meta as JSON.";
  public schema = z.object({
    messages: z.array(z.string()).optional(),
  });
  public handler(
    { messages = ["working", "done"] }: z.infer<typeof this.schema>,
    context: ChatAgentContext,
  ): string {
    for (const message of messages) {
      context.eventProducer.emit(EventName.ToolProgress, {
        context,
        message,
      });
    }
    return JSON.stringify(context.meta);
  }
}

/** Returns a PNG attachment for MCP image round-trip tests. */
export class ImageTool extends BaseTool {
  public name = "image";
  public description = "Returns a tiny PNG attachment.";
  public schema = z.object({});
  public handler(): ToolResult {
    return {
      content: "here",
      attachments: [{ mimeType: "image/png", data: "AAAA" }],
    };
  }
}
