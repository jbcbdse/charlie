import EventEmitter from "events";
import {
  EventName,
  eventProducer,
  EventProducer,
  EventTypeMap,
} from "./event-producer";

export class EventSubscriber {
  private emitter: EventEmitter;
  constructor(producer?: EventProducer) {
    if (!producer) {
      producer = eventProducer;
    }
    this.emitter = producer.emitter;
  }

  public on<T extends EventName>(
    eventName: T,
    listener: (event: EventTypeMap[T], eventName: T) => void,
  ): void {
    this.emitter.on(eventName, listener);
  }

  public once<T extends EventName>(
    eventName: T,
    listener: (event: EventTypeMap[T], eventName: T) => void,
  ): void {
    this.emitter.once(eventName, listener);
  }

  public off<T extends EventName>(
    eventName: T,
    listener: (event: EventTypeMap[T], eventName: T) => void,
  ): void {
    this.emitter.off(eventName, listener);
  }
}

export const events = new EventSubscriber();
