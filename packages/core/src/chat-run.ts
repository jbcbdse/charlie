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

export function createChatRun(
  producer: EventProducer,
  runId: string,
  work: () => Promise<ChatAgentGetResponseOutput>,
): ChatRun {
  const subscriber = new EventSubscriber(producer);
  const wrappers = new Map<
    EventName,
    Map<Listener<EventName>, Listener<EventName>>
  >();

  const promise = new Promise<ChatAgentGetResponseOutput>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        work().then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  });

  const offAll = () => {
    for (const [eventName, listeners] of wrappers) {
      for (const wrapped of listeners.values()) {
        subscriber.off(eventName, wrapped);
      }
    }
    wrappers.clear();
  };

  void promise.finally(offAll).catch(() => undefined);

  const run = promise as ChatRun;

  run.on = <T extends EventName>(eventName: T, listener: Listener<T>) => {
    const wrapped: Listener<T> = (event, name) => {
      if (event.context.runId !== runId) return;
      try {
        listener(event, name);
      } catch {
        // Consumer faults must not reject the run.
      }
    };
    let byListener = wrappers.get(eventName);
    if (!byListener) {
      byListener = new Map();
      wrappers.set(eventName, byListener);
    }
    const previous = byListener.get(listener as Listener<EventName>);
    if (previous) {
      subscriber.off(eventName, previous);
    }
    byListener.set(
      listener as Listener<EventName>,
      wrapped as Listener<EventName>,
    );
    subscriber.on(eventName, wrapped);
  };

  run.off = <T extends EventName>(eventName: T, listener: Listener<T>) => {
    const byListener = wrappers.get(eventName);
    const wrapped = byListener?.get(listener as Listener<EventName>);
    if (wrapped) {
      subscriber.off(eventName, wrapped);
      byListener?.delete(listener as Listener<EventName>);
    }
  };

  run[Symbol.asyncIterator] = async function* () {
    const queue: EventChatStreamChunk[] = [];
    let settled = false;
    let failure: unknown;
    let notify: (() => void) | undefined;
    const onChunk: Listener<EventName.ChatStreamChunk> = (event) => {
      queue.push(event);
      notify?.();
    };
    run.on(EventName.ChatStreamChunk, onChunk);
    void promise.then(
      () => {
        settled = true;
        notify?.();
      },
      (err: unknown) => {
        failure = err;
        settled = true;
        notify?.();
      },
    );
    try {
      while (!settled || queue.length > 0) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (failure !== undefined) throw failure;
    } finally {
      run.off(EventName.ChatStreamChunk, onChunk);
    }
  };

  return run;
}
