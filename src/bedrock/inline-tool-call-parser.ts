import { v4 as uuidv4 } from "uuid";
import {
  ChatMessage,
  ChatMessageTransformer,
  MessageAssistant,
  MessageToolCall,
} from "../core/types";
import { ILogger, Logger } from "../core/logger";
/**
 * Some models do not produce tool call objects in the response, but instead include the tool call as a string in the response text. This class attempts to parse the tool call from the response text.
 */
export class InlineToolCallParser implements ChatMessageTransformer {
  private logger: ILogger;
  constructor(options: { logger?: ILogger } = {}) {
    this.logger = options.logger || new Logger();
  }
  transform(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      return msg.role === "assistant"
        ? this.parseInlineFunction(msg) || msg
        : msg;
    });
  }
  /**
   * Mistral Large intermittantly returns text that includes a function call rather than a tool call object. This is presumably a bug in the Converse API for this model, failing to parse the tool call from the text generation. So we can try to parse the tool call out of the response text
   *
   * Llama 3 is not supported for function calling by the Converse API at all, so this will attempt to parse function calls from the unsupported model
   *
   * Titan also does not support function calling by the Converse API. It oftens disobeys the instructed tool call format and produces something similar. We'll try to parse a few variations of the tool call from the response text.
   *
   * It sometimes generates a pythonic syntax that is not attempted to be parsed here.
   *
   * The tool call may contain other text such as "Fine, let me call this tool for you..." That text is not preserved here.
   */
  public parseInlineFunction(msg: MessageAssistant): MessageToolCall | null {
    let text = msg.content;
    text = text.replace(/,\n\s*{/gm, ",{");
    text = text.replace(/\[\n\s*\{/gm, "[{");
    text = text.replace(/\}\n\s*\]/gm, "}]");
    const matches = [...text.matchAll(/\[\{"(name|tool)".*$/gm)];
    if (!matches.length) {
      return null;
    }
    try {
      this.logger.debug("Parsing inline function from response text", {
        text,
      });
      type ExpectedToolCall = { name: string; arguments: unknown };
      type TitanVariantToolCall = { tool: string; arguments: unknown };
      type ParsedToolCall = ExpectedToolCall | TitanVariantToolCall;
      return {
        role: "tool_call" as const,
        toolCalls: matches
          .map((match) => {
            match[0] = match[0].substring(0, match[0].lastIndexOf("]") + 1);
            const calls: ParsedToolCall[] = JSON.parse(match[0]);
            return calls.map((call) => ({
              function: {
                name: "name" in call ? call.name : call.tool,
                arguments: call.arguments as Record<string, unknown>,
              },
              id: `call_${uuidv4()}`,
              type: "function" as const,
            }));
          })
          .flat(),
      };
    } catch (e) {
      this.logger.error("Error parsing inline function: " + String(e), {
        error: e,
      });
      return null;
    }
  }
}
