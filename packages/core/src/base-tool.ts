/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { ChatAgentContext } from "./types";

/**
 * All tools must confirm to this interface
 */
export interface ITool {
  name: string;
  description: string;
  /**
   * JSON schema for the parameters of the tool
   */
  readonly jsonSchema: any;
  /**
   * if true, the tool response will be returned directly to the user
   * if false, the tool response will be sent back to the LLM
   */
  returnDirect?: boolean;
  handle(params: any, context: ChatAgentContext): Promise<string>;
}
/**
 * User-defined tools can extend this class to automatically validate with a zod schema
 */
export abstract class BaseTool implements ITool {
  public abstract name: string;
  public abstract description: string;
  public abstract schema: z.ZodType;
  public returnDirect = false;
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
  ): string | Promise<string>;
}
