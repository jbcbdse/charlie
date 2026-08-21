import { BaseTool } from "@jbcbdse/charlie-core";
import { z } from "zod";

/** Simple round-trippable tool used across specs to exercise a real tools/call. */
export class EchoTool extends BaseTool {
  public name = "echo";
  public description = "Echoes the given message back.";
  public schema = z.object({
    message: z.string().describe("The message to echo back."),
  });
  public handler({ message }: z.TypeOf<typeof this.schema>): string {
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
