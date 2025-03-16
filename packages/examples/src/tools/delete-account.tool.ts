import { BaseTool } from "@jbcbdse/charlie-core";
import { z } from "zod";

export class DeleteAccountTool extends BaseTool {
  public name = "DeleteAccountTool";
  public description = "Use this tool to delete the user's account";
  public schema = z.object({
    userIsCertain: z
      .boolean()
      .describe(
        "Whether the user has indicated in at least two messages that they want to delete their account",
      ),
  });
  public handler({ userIsCertain }: z.TypeOf<typeof this.schema>): string {
    if (userIsCertain) {
      return "The user's account has been deleted";
    }
    return "Ask the user to confirm that they want to delete their account and then call this tool again";
  }
}
