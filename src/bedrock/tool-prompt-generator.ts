import { BaseTool } from "../core/base-tool";

export class ToolPromptGenerator {
  /**
   * This should be used when for Bedrock models that do not support tool calls
   */
  public generateToolPrompt(tools: BaseTool[]): string {
    return [
      "You have the following tools available to help answer the user's request. You can call a one or more functions at a time. The functions are described here in JSON-schema format",
      "",
      ...tools.map((tool) =>
        JSON.stringify({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.jsonSchema,
          },
        }),
      ),
      "",
      "To call one or more tools, provide the tool calls on a new line as a JSON-formatted array. Explain your steps in a neutral tone. Then, only call the tools you can for the first step, then end your turn. If you previously received an error, you can try to call the tool again. Give up after 3 errors.",
      "",
      "Conform precisely to the single-line format of this example",
      "Tool Call:",
      '[{"name": "SampleTool", "arguments": {"foo": "bar"}},{"name": "SampleTool", "arguments": {"foo": "other"}}]',
    ].join("\n");
  }
}
