# charlie-datadog

## Description

This provides a class that subscribes to Charlie's EventProducer and uses the Datadog API to submit traces to Datadog's LLM Observability API

## Installation

```
npm install @jbcbdse/charlie-datadog
```

## Usage

```ts
import { LlmSpansApi } from "@jbcbdse/charlie-datadog";
import { events } from "@jbcbdse/charlie-core";
// ...

new LlmSpansApi({
  apiKey: "your-datadog-api-key",
  tags: {
    service: "my-service",
    env: "dev",
  }
}).listen(events);
```
This will use the API to send LLM traces to Datadog
