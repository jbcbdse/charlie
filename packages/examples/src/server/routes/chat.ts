/* eslint-disable no-console */
import { Request, Response } from "express";
import {
  ChatAgent,
  ChatAgentGetResponseOutput,
  ChatMessage,
  EventLog,
  EventName,
  EventSubscriber,
  EventToolProgress,
  ITool,
  MessageUser,
} from "@jbcbdse/charlie-core";
import { randomUUID } from "node:crypto";
import { AvailableAgent } from "./agents";

interface ChatRequest {
  message: string;
  agent?: AvailableAgent;
  messages?: ChatMessage[];
  user?: Record<string, string>;
  stream?: boolean;
}

interface CapturedEvent {
  name: EventName.ToolProgress | EventName.Log;
  message: string;
  level?: EventLog["level"];
  meta?: EventLog["meta"];
}

function toJsonBody(
  result: ChatAgentGetResponseOutput,
  history: ChatMessage[],
  agent: AvailableAgent,
  captured: CapturedEvent[],
) {
  const assistantMessages = result.responseMessages.filter(
    (m) => m.role === "assistant",
  );
  const responseText = assistantMessages.map((m) => m.content).join("\n");
  const updatedMessages: ChatMessage[] = [...history, ...assistantMessages];
  return {
    response: responseText,
    agent,
    messages: updatedMessages,
    usage: result.usage,
    events: captured,
  };
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
      agent = "claude",
      messages = [],
      user = {},
      stream = false,
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
    const requestId = randomUUID();
    const captured: CapturedEvent[] = [];
    const meta = {
      requestId,
      user: {
        first_name: "Jonathan",
        last_name: "Barnett",
        preferred_name: "Jon",
        ...user,
      },
      availableAgents,
    };

    if (stream) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const writeEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        const run = agents[agent].getResponse({
          messages: history,
          tools,
          meta,
        });
        run.on(EventName.ChatStreamChunk, ({ chunk }) => {
          writeEvent("chunk", chunk);
        });
        run.on(EventName.ToolProgress, (event) => {
          captured.push({
            name: EventName.ToolProgress,
            message: event.message,
          });
          writeEvent("tool:progress", {
            message: event.message,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
          });
        });
        run.on(EventName.Log, (event) => {
          captured.push({
            name: EventName.Log,
            message: event.message,
            level: event.level,
            meta: event.meta,
          });
          writeEvent("log", {
            message: event.message,
            level: event.level,
            meta: event.meta,
          });
        });
        const result = await run;
        writeEvent("done", toJsonBody(result, history, agent, captured));
        res.end();
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("Chat error:", err);
        writeEvent("error", { error });
        res.end();
      }
      return;
    }

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
        meta,
      });
      res.json(toJsonBody(result, history, agent, captured));
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", err);
      res.status(500).json({ error });
    } finally {
      appEvents.off(EventName.ToolProgress, onProgress);
      appEvents.off(EventName.Log, onLog);
    }
  };
}
