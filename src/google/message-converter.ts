import { Content, Part } from "@google/generative-ai";
import { ChatMessage } from "../core";

export class MessageConverter {
  public toContentObjects(messages: ChatMessage[]): Content[] {
    const contents = this.condense(
      messages.map((message) => this.toContent(message)),
    );
    return contents;
  }
  private condense(contentObjects: Content[]): Content[] {
    return contentObjects.reduce((acc, content) => {
      const last = acc.at(-1);
      if (last?.role !== content.role) {
        acc.push(content);
      } else {
        last.parts ??= [];
        last.parts.push(...content.parts);
      }
      return acc;
    }, [] as Content[]);
  }
  public toContent(message: ChatMessage): Content {
    if (message.role === "assistant") {
      return {
        role: "model",
        parts: [
          {
            text: message.content,
          },
        ],
      };
    }
    if (message.role == "user") {
      return {
        role: "user",
        parts: [
          {
            text: message.content,
          },
        ],
      };
    }
    if (message.role === "system") {
      return {
        role: "user",
        parts: [
          {
            // TODO add something to indicate this is a system message
            text: message.content,
          },
        ],
      };
    }
    if (message.role === "tool") {
      const key = message.status === "error" ? "error" : "result";
      return {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name,
              response: { [key]: message.content },
            },
          },
        ],
      };
    }
    if (message.role === "tool_call") {
      return {
        role: "model",
        parts: message.toolCalls.map(
          (toolCall): Part => ({
            functionCall: {
              name: toolCall.function.name,
              args: toolCall.function.arguments,
            },
          }),
        ),
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`Unknown message role: ${(message as any).role}`);
  }

  responseContentChatMessages(content: Content): ChatMessage[] {
    return content.parts.map((part): ChatMessage => {
      if (part.text) {
        return {
          role: "assistant",
          content: part.text,
        };
      }
      if (part.functionCall) {
        return {
          role: "tool_call",
          toolCalls: [
            {
              id: "1",
              type: "function",
              function: {
                name: part.functionCall.name,
                // @ts-expect-error Google says `object` which should be assignable
                arguments: part.functionCall.args,
              },
            },
          ],
        };
      }
      // no other part responses are expected or supported
      throw new Error(`Unknown part type: ${JSON.stringify(part)}`);
    });
  }
}
