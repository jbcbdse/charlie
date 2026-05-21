import { BaseTool } from "@jbcbdse/charlie-core";
import { z } from "zod";

/**
 * This is a very simple example of a tool that returns a direct response
 */
export class DirectBirthdayTool extends BaseTool {
  public name = "DirectBirthdayTool";
  public description = "Use this tool to set and remember the user's birthday";
  public schema = z.object({
    year: z.number().describe("The year of the user's birthday"),
    month: z.number().describe("The month of the user's birthday"),
    day: z.number().describe("The day of the user's birthday"),
  });
  public returnDirect = true;
  public handler({ year, month, day }: z.TypeOf<typeof this.schema>): string {
    return `Your birthday has been set to ${year}-${month}-${day}. (Direct tool response example)`;
  }
}
