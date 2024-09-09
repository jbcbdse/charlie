/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { ChatAgentContext } from "./types";

interface ITool {
  name: string;
  description: string;
  readonly jsonSchema: any;
  handle(params: any, context: ChatAgentContext): Promise<string>;
}
/**
 * All user-defined tools should extend this class
 */
export abstract class BaseTool implements ITool {
  public abstract name: string;
  public abstract description: string;
  public abstract schema: z.ZodType;
  public get jsonSchema(): any {
    return zodToJsonSchema(this.schema);
  }
  /**
   * This method should be called by the executor and performs validation
   */
  public async handle(params: any, context: ChatAgentContext): Promise<string> {
    params = await this.schema.parseAsync(params).catch((err) => {
      throw new Error(
        `Invalid parameters for tool ${this.name}: ${err.message}`,
      );
    });
    return this.handler(params, context);
  }
  public abstract handler(
    params: z.infer<typeof this.schema>,
    context: ChatAgentContext,
  ): string;
}
