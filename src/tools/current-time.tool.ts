import { BaseTool } from "../core/base-tool";
import { z } from "zod";

export class CurrentTimeTool extends BaseTool {
  public name = CurrentTimeTool.name;
  public description = "Get the current day and time.";
  public schema = z.object({});
  public handler(): string {
    const now = new Date();
    const nowString = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "America/Chicago",
    }).format(now);
    return `The current time is ${nowString}`;
  }
}
