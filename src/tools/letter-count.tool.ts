import { z } from "zod";
import { BaseTool } from "../core/base-tool";

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
  public handler({ word, letter }: z.infer<typeof this.schema>): string {
    const count = word.toLowerCase().split(letter.toLowerCase()).length - 1;
    return `There are ${count} "${letter.toUpperCase()}"s in "${word}".`;
  }
}
