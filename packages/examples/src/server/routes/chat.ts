/* eslint-disable no-console */
import { Request, Response } from "express";
import {
  ChatAgent,
  ChatMessage,
  EventLog,
  EventName,
  EventSubscriber,
  EventToolProgress,
  ITool,
  MessageUser,
} from "@jbcbdse/charlie-core";
import { randomUUID } from "node:crypto";
import { AvailableAgent, DEFAULT_AGENT, agentKeysByProvider } from "./agents";

interface ChatRequest {
  message: string;
  agent?: AvailableAgent;
  messages?: ChatMessage[];
  user?: Record<string, string>;
}

interface CapturedEvent {
  name: EventName.ToolProgress | EventName.Log;
  message: string;
  level?: EventLog["level"];
  meta?: EventLog["meta"];
}

export function chatHandler(
  agents: Record<AvailableAgent, ChatAgent>,
  availableAgents: AvailableAgent[],
  tools: ITool[],
  appEvents: EventSubscriber,
) {
  return async (req: Request, res: Response) => {
    const {
      message,
      agent = DEFAULT_AGENT,
      messages = [],
      user = {},
    }: ChatRequest = req.body;

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    if (!availableAgents.includes(agent)) {
      res.status(400).json({
        error: `unknown agent: ${agent}. Available: ${availableAgents.join(", ")}`,
      });
      return;
    }

    const userMessage: MessageUser = { role: "user", content: message };
    const history: ChatMessage[] = [...messages, userMessage];

    // Tag every event from this request via meta.requestId so we can pull our
    // own events out of the shared producer without picking up concurrent
    // requests' events.
    const requestId = randomUUID();
    const captured: CapturedEvent[] = [];
    const onProgress = (event: EventToolProgress): void => {
      if (event.context.meta.requestId === requestId) {
        captured.push({
          name: EventName.ToolProgress,
          message: event.message,
        });
      }
    };
    const onLog = (event: EventLog): void => {
      if (event.context.meta.requestId === requestId) {
        captured.push({
          name: EventName.Log,
          message: event.message,
          level: event.level,
          meta: event.meta,
        });
      }
    };
    appEvents.on(EventName.ToolProgress, onProgress);
    appEvents.on(EventName.Log, onLog);

    try {
      const result = await agents[agent].getResponse({
        messages: history,
        tools,
        meta: {
          requestId,
          user: {
            first_name: "Jonathan",
            last_name: "Barnett",
            preferred_name: "Jon",
            ...user,
          },
          availableAgents: agentKeysByProvider,
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
        events: captured,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", err);
      res.status(500).json({ error: message });
    } finally {
      appEvents.off(EventName.ToolProgress, onProgress);
      appEvents.off(EventName.Log, onLog);
    }
  };
}
