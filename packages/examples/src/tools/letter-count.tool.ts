import { z } from "zod";
import { BaseTool, ChatAgentContext, EventName } from "@jbcbdse/charlie-core";

export class CountLettersTool extends BaseTool {
  public name = CountLettersTool.name;
  public description =
    "Count the number of times a letter appears in a word or phrase.";
  public schema = z.object({
    word: z
      .string()
      .describe("The word or phrase whose letters you want to count."),
    letter: z
      .string()
      .describe("The letter you want to count in the word or phrase."),
  });
  public handler(
    { word, letter }: z.infer<typeof this.schema>,
    context: ChatAgentContext,
  ): string {
    context.eventProducer.emit(EventName.Log, {
      context,
      level: "info",
      message: "CountLettersTool starting",
      meta: { word, letter },
    });
    context.eventProducer.emit(EventName.ToolProgress, {
      context,
      message: `Scanning "${word}" for "${letter}"`,
    });
    const count = word.toLowerCase().split(letter.toLowerCase()).length - 1;
    context.eventProducer.emit(EventName.ToolProgress, {
      context,
      message: `Found ${count} match(es)`,
    });
    context.eventProducer.emit(EventName.Log, {
      context,
      level: "debug",
      message: "CountLettersTool finished",
      meta: { word, letter, count },
    });
    return `There are ${count} "${letter.toUpperCase()}"s in "${word}".`;
  }
}
