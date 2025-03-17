import { Transcriber } from "@jbcbdse/charlie-core";
import OpenAI from "openai";
import type * as fs from "fs";
export class WhisperTranscriber implements Transcriber {
  private model: string;
  private sdk: OpenAI;
  constructor(options: {
    model?: string;
    apiKey: string;
    maxRetries?: number;
    timeout?: number;
  }) {
    this.model = options.model ?? "whisper-1";
    this.sdk = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries,
      timeout: options.timeout,
    });
  }

  async transcribe(options: { file: fs.ReadStream }): Promise<{
    text: string;
  }> {
    const response = await this.sdk.audio.transcriptions.create({
      model: this.model,
      file: options.file,
      response_format: "verbose_json",
    });
    return {
      text: response.text,
    };
  }
}
