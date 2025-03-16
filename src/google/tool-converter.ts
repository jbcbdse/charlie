import toOpenApi from "@openapi-contrib/json-schema-to-openapi-schema";
import { BaseTool } from "../core";
import { FunctionDeclaration, Tool } from "@google/generative-ai";

export class ToolConverter {
  public async toGeminiTools(tools: BaseTool[]): Promise<Tool[]> {
    const geminiTools = [
      {
        functionDeclarations: await Promise.all(
          tools.map((tool) => this.toFunctionDeclaration(tool)),
        ),
      },
    ];
    return geminiTools;
  }
  private async toFunctionDeclaration(
    tool: BaseTool,
  ): Promise<FunctionDeclaration> {
    type ReturnedSchema = Required<
      Required<Awaited<ReturnType<typeof toOpenApi>>>["components"]
    >["schemas"][string];
    const openApiSchema: ReturnedSchema = await toOpenApi(tool.jsonSchema);
    const noArgs =
      openApiSchema.type === "object" &&
      Object.keys(openApiSchema.properties!).length === 0;
    delete openApiSchema.additionalProperties;
    return {
      name: tool.name,
      description: tool.description,
      // @ts-expect-error The types should match. Google expects openapi schema, and the toOpenApi return value should match
      parameters: noArgs ? undefined : openApiSchema,
    };
  }
}
