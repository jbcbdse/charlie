/* eslint-disable no-console */
import { Request, Response } from "express";
import { ChatAgent, ChatMessage, ITool, MessageUser } from "@jbcbdse/charlie-core";
import { AvailableAgent } from "./agents";

interface ChatRequest {
  message: string;
  agent?: AvailableAgent;
  messages?: ChatMessage[];
  user?: Record<string, string>;
}

export function chatHandler(
  agents: Record<AvailableAgent, ChatAgent>,
  availableAgents: AvailableAgent[],
  tools: ITool[],
) {
  return async (req: Request, res: Response) => {
    const { message, agent = "claude", messages = [], user = {} }: ChatRequest = req.body;

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    if (!availableAgents.includes(agent)) {
      res.status(400).json({ error: `unknown agent: ${agent}. Available: ${availableAgents.join(", ")}` });
      return;
    }

    const userMessage: MessageUser = { role: "user", content: message };
    const history: ChatMessage[] = [...messages, userMessage];

    try {
      const result = await agents[agent].getResponse({
        messages: history,
        tools,
        meta: {
          user: { first_name: "Jonathan", last_name: "Barnett", preferred_name: "Jon", ...user },
          availableAgents,
        },
      });

      const assistantMessages = result.responseMessages.filter(
        (m) => m.role === "assistant",
      );
      const responseText = assistantMessages.map((m) => m.content).join("\n");
      const updatedMessages: ChatMessage[] = [...history, ...assistantMessages];

      res.json({
        response: responseText,
        agent,
        messages: updatedMessages,
        usage: result.usage,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", err);
      res.status(500).json({ error: message });
    }
  };
}
