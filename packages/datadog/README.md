# charlie-datadog

## Description

This provides a class that subscribes to Charlie's EventProducer and uses the Datadog API to submit traces to Datadog's LLM Observability API

## Installation

```
npm install @ifit/charlie-datadog
```

## Usage

```ts
import { LlmSpansApi } from "@ifit/charlie-datadog";
import { events } from "@ifit/charlie-core";
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
