import axios, { AxiosInstance } from "axios";
import {
  EventName,
  EventSubscriber,
  ChatAgentContext,
  ChatMessage,
  EventChatEnd,
  EventChatExecutorEnd,
  EventChatStart,
  EventToolEnd,
} from "@jbcbdse/charlie-core";
import { v4 as uuid } from "uuid";

interface SpansRequest {
  data: SpansRequestData;
}
interface SpansRequestData {
  type: "span";
  attributes: SpansPayload;
}
interface SpansPayload {
  ml_app: string;
  spans: Span[];
  tags: Tag[];
  session_id: string;
}
interface Span {
  name: string;
  span_id: string;
  trace_id: string;
  parent_id: string | undefined;
  /** The span's start time in nanoseconds */
  start_ns: number;
  /** The span's duration in nanoseconds */
  duration: number;
  meta: Meta;
  status?: "ok" | "error";
  metrics?: Metrics;
  session_id: string;
  tags: Tag[];
}
/** A tag should be a string in the format of {key}:{value} */
type Tag = string;
interface Metrics {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  reasoning_output_tokens?: number;
  time_to_first_token?: number;
  time_per_output_token?: number;
}
interface Meta {
  kind:
    | "agent"
    | "workflow"
    | "llm"
    | "tool"
    | "task"
    | "embedding"
    | "retrieval";
  error?: DDError;
  input: IO;
  output: IO;
  metadata: LlmMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
interface LlmMetadata {
  temperature?: number;
  max_tokens?: number;
  model_name?: string;
  model_provider?: string;
}
interface IO {
  value?: string;
  messages?: Message[];
  // documents?: Document[] is not implemented
}
interface Message {
  content: string;
  role: string;
}
interface DDError {
  message: string;
  stack: string;
  type: string;
}

interface RunData {
  runId: string;
  modelId: string;
  traceId: string;
  parentSpanId?: string;
  context: ChatAgentContext;
  runSpanId: string;
  spans: Span[];
  timer: NodeJS.Timeout;
}
export class LlmSpansApi {
  private axiosInstance: AxiosInstance;
  private tags: Record<string, string>;
  private runs = new Map<string, RunData>();
  private readonly minDuration = 1_000; // 1µs in nanoseconds

  constructor(options: {
    apiKey: string;
    axiosInstance?: AxiosInstance;
    tags?: Record<string, string>;
  }) {
    this.axiosInstance =
      options.axiosInstance ??
      axios.create({
        headers: {
          "DD-API-KEY": options.apiKey,
          "Content-Type": "application/json",
        },
      });
    this.tags = options.tags ?? {};
    this.tags.service ??= "charlie";
    this.tags.env ??= "dev";
  }

  public listen(events: EventSubscriber) {
    events.on(EventName.ChatStart, this.handleChatStart.bind(this));
    events.on(EventName.ChatEnd, this.handleChatEnd.bind(this));
    events.on(EventName.ToolEnd, this.handleToolEnd.bind(this));
    events.on(EventName.ChatExecutorEnd, this.handleExecutionEnd.bind(this));
  }

  public handleChatStart(event: EventChatStart) {
    const runId = event.context.runId;
    const traceId = uuid();
    const parentSpanId = "undefined";
    const timer: NodeJS.Timeout = setTimeout(() => {
      this.runs.delete(runId);
    }, 600_000);
    const runData = {
      runId,
      modelId: event.context.modelId,
      traceId,
      parentSpanId,
      runSpanId: uuid(),
      context: event.context,
      spans: [],
      timer,
    };
    this.runs.set(runId, runData);
  }

  public handleChatEnd(event: EventChatEnd) {
    const runData = this.runs.get(event.context.runId);
    if (!runData) {
      return;
    }
    const span: Span = {
      name: "ChatAgent",
      span_id: runData.runSpanId,
      trace_id: runData.traceId,
      parent_id: runData.parentSpanId ?? "undefined",
      start_ns: event.startTime * 1e6,
      duration: event.timeMs * 1e6,
      meta: {
        kind: "agent",
        input: { messages: event.context.messages.map(this.toMessage).flat() },
        output: { messages: event.messages.map(this.toMessage).flat() },
        metadata: {
          model_name: event.context.modelId,
        },
        model_name: event.context.modelId,
      },
      session_id: event.context.runId,
      tags: Object.entries(this.tags).map(([key, value]) => `${key}:${value}`),
    };
    const request: SpansRequest = {
      data: {
        type: "span",
        attributes: {
          ml_app: this.tags.service || "charlie",
          session_id: event.context.runId,
          spans: [span, ...runData.spans],
          tags: Object.entries(this.tags).map(
            ([key, value]) => `${key}:${value}`,
          ),
        },
      },
    };
    this.runs.delete(event.context.runId);
    if (runData.timer) {
      clearTimeout(runData.timer);
    }
    this.axiosInstance
      .post(
        "https://api.datadoghq.com/api/intake/llm-obs/v1/trace/spans",
        request,
        {},
      )
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Failed to send spans to Datadog", {
          error: err,
          requestErrors: err.response.data.errors,
        });
      });
  }

  private handleToolEnd(event: EventToolEnd) {
    const runData = this.runs.get(event.context.runId);
    if (!runData) {
      return;
    }

    const toolCall = event.toolCall.toolCalls.find(
      (tc) => tc.id === event.toolCallId,
    );
    const span: Span = {
      name: toolCall?.function.name || "Tool call",
      span_id: uuid(),
      trace_id: runData.traceId,
      parent_id: runData.runSpanId,
      start_ns: event.startTime * 1e6,
      duration: Math.max(event.timeMs * 1e6, this.minDuration),
      meta: {
        kind: "tool",
        input: {
          messages: [this.toMessage(event.toolCall)].flat(),
        },
        output: { messages: [this.toMessage(event.toolMessage)].flat() },
        metadata: {},
      },
      session_id: event.context.runId,
      tags: Object.entries(this.tags).map(([key, value]) => `${key}:${value}`),
    };
    runData?.spans.push(span);
  }

  private handleExecutionEnd(event: EventChatExecutorEnd) {
    const runData = this.runs.get(event.context.runId);
    if (!runData) {
      return;
    }
    const span: Span = {
      name: "ChatExecutor",
      span_id: uuid(),
      trace_id: runData.traceId,
      parent_id: runData.runSpanId,
      start_ns: event.startTime * 1e6,
      duration: Math.max(event.timeMs * 1e6, this.minDuration),
      meta: {
        kind: "llm",
        input: { messages: event.messages.map(this.toMessage).flat() },
        output: { messages: event.responseMessages.map(this.toMessage).flat() },
        metadata: {
          model_name: event.modelId,
          model_provider: event.modelProvider,
        },
        model_provider: event.modelProvider,
        model_name: event.modelId,
      },
      session_id: event.context.runId,
      tags: Object.entries(this.tags).map(([key, value]) => `${key}:${value}`),
      metrics: {
        input_tokens: event.usage?.inputTokens,
        output_tokens: event.usage?.outputTokens,
        total_tokens: event.usage?.totalTokens,
        reasoning_output_tokens: event.usage?.reasoningTokens,
      },
    };
    runData.spans.push(span);
  }

  private toMessage(msg: ChatMessage): Message | Message[] {
    if (msg.role === "assistant") {
      return { content: msg.content, role: "assistant" };
    }
    if (msg.role === "user") {
      return { content: msg.content, role: "user" };
    }
    if (msg.role === "system") {
      return { content: msg.content, role: "system" };
    }
    if (msg.role === "tool_call") {
      return msg.toolCalls.map((toolCall) => {
        return {
          content: `Tool call: ${toolCall.function.name}(${JSON.stringify(toolCall.function.arguments)})`,
          role: "tool_call",
        };
      });
    }
    if (msg.role === "tool") {
      return { content: msg.content, role: "tool" };
    }
    if (msg.role === "reasoning") {
      return { content: msg.content ?? "", role: "reasoning" };
    }
    return {
      content: "Unknown message role",
      role: "unknown",
    };
  }
}
