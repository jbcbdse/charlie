import { Content, Part } from "@google/generative-ai";
import { ChatMessage } from "@jbcbdse/charlie-core";

export class MessageConverter {
  public toContentObjects(messages: ChatMessage[]): Content[] {
    const contents = this.condense(
      messages
        .filter((message) => message.role !== "reasoning")
        .map((message) => this.toContent(message)),
    );
    return contents;
  }
  private condense(contentObjects: Content[]): Content[] {
    return contentObjects.reduce((acc, content) => {
      const last = acc[acc.length - 1];
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
    const messages: ChatMessage[] = [];
    for (const part of content.parts ?? []) {
      if ("thought" in part && part.thought) {
        continue;
      }
      if (part.text) {
        const last = messages[messages.length - 1];
        if (last?.role === "assistant") {
          last.content += part.text;
        } else {
          messages.push({ role: "assistant", content: part.text });
        }
        continue;
      }
      if (part.functionCall) {
        messages.push({
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
        });
      }
    }
    return messages;
  }
}
