import { BaseTool } from "../core/base-tool";
import { z } from "zod";
import { Parser } from "expr-eval";

export class CalculatorTool extends BaseTool {
  public name = "CalculatorTool";
  public description =
    "Call this tool to perform any basic math. The input to this tool should be a valid mathematical expression that could be executed by a simple calculator. Only provide constants and operators";
  public schema = z.object({
    expr: z
      .string()
      .describe("A valid mathematical expression. Do not use variables."),
  });
  public handler({ expr }: z.TypeOf<typeof this.schema>): string {
    try {
      return new Parser().parse(expr).evaluate().toString();
    } catch (e) {
      throw new Error(
        "Invalid expression. Only provide numbers and operators without variables. You may try again",
      );
    }
  }
}
