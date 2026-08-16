import {
  EventName,
  EventProducer,
  EventTypeMap,
  EventChatStreamChunk,
} from "./event-producer";
import { EventSubscriber } from "./event-subscriber";
import { ChatAgentGetResponseOutput, ChatRun } from "./types";

type Listener<T extends EventName> = (
  event: EventTypeMap[T],
  eventName: T,
) => void;

export class ChatRunGenerator {
  private readonly subscriber: EventSubscriber;
  private readonly wrappers = new Map<
    EventName,
    Map<Listener<EventName>, Listener<EventName>>
  >();
  private settled = false;
  private readonly promise: Promise<ChatAgentGetResponseOutput>;
  private readonly run: ChatRun;

  constructor(
    producer: EventProducer,
    private readonly runId: string,
    work: () => Promise<ChatAgentGetResponseOutput>,
  ) {
    this.subscriber = new EventSubscriber(producer);
    this.promise = new Promise((resolve, reject) => {
      queueMicrotask(() => {
        try {
          work().then(resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    });
    void this.promise.finally(() => this.offAll()).catch(() => undefined);
    this.run = this.promise as ChatRun;
    this.run.on = (eventName, listener) => this.on(eventName, listener);
    this.run.off = (eventName, listener) => this.off(eventName, listener);
    this.run[Symbol.asyncIterator] = () => this.iterate();
  }

  public create(): ChatRun {
    return this.run;
  }

  private on<T extends EventName>(eventName: T, listener: Listener<T>): void {
    if (this.settled) return;
    const wrapped: Listener<T> = (event, name) => {
      if (event.context.runId !== this.runId) return;
      try {
        listener(event, name);
      } catch {
        // Consumer faults must not reject the run.
      }
    };
    let byListener = this.wrappers.get(eventName);
    if (!byListener) {
      byListener = new Map();
      this.wrappers.set(eventName, byListener);
    }
    const previous = byListener.get(listener as Listener<EventName>);
    if (previous) {
      this.subscriber.off(eventName, previous);
    }
    byListener.set(
      listener as Listener<EventName>,
      wrapped as Listener<EventName>,
    );
    this.subscriber.on(eventName, wrapped);
  }

  private off<T extends EventName>(eventName: T, listener: Listener<T>): void {
    const byListener = this.wrappers.get(eventName);
    const wrapped = byListener?.get(listener as Listener<EventName>);
    if (wrapped) {
      this.subscriber.off(eventName, wrapped);
      byListener?.delete(listener as Listener<EventName>);
    }
  }

  private offAll(): void {
    this.settled = true;
    for (const [eventName, listeners] of this.wrappers) {
      for (const wrapped of listeners.values()) {
        this.subscriber.off(eventName, wrapped);
      }
    }
    this.wrappers.clear();
  }

  private async *iterate(): AsyncGenerator<EventChatStreamChunk> {
    const queue: EventChatStreamChunk[] = [];
    let done = false;
    let failed = false;
    let failure: unknown;
    let notify: (() => void) | undefined;
    const onChunk: Listener<EventName.ChatStreamChunk> = (event) => {
      queue.push(event);
      notify?.();
    };
    this.on(EventName.ChatStreamChunk, onChunk);
    void this.promise.then(
      () => {
        done = true;
        notify?.();
      },
      (err: unknown) => {
        failure = err;
        failed = true;
        done = true;
        notify?.();
      },
    );
    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (failed) throw failure;
    } finally {
      this.off(EventName.ChatStreamChunk, onChunk);
    }
  }
}
