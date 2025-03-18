import { OpenAI } from "openai";
import { TextToSpeechGenerator } from "@jbcbdse/charlie-core";
import { SpeechCreateParams } from "openai/resources/audio/speech";

/**
 * Text-to-speech generator using OpenAI's TTS API
 * Supports multiple voices and models
 */
export class OpenAITextToSpeechGenerator implements TextToSpeechGenerator {
  private openai: OpenAI;
  private model: string;
  private voice: SpeechCreateParams["voice"];

  /**
   * Creates a new OpenAITextToSpeechGenerator
   *
   * @param options Configuration options
   * @param options.apiKey OpenAI API key
   * @param options.model TTS model to use (default: "tts-1")
   * @param options.voice Voice to use (default: "nova")
   */
  constructor(options: {
    apiKey: string;
    model?: string;
    voice?: SpeechCreateParams["voice"];
  }) {
    this.openai = new OpenAI({
      apiKey: options.apiKey,
    });
    this.model = options.model || "tts-1";
    this.voice = options.voice || "nova";
  }

  /**
   * Generates speech from text
   *
   * @param text The text to convert to speech
   * @returns Object containing the audio buffer and format
   */
  async generate(text: string): Promise<{ buffer: Buffer; format: string }> {
    const response = await this.openai.audio.speech.create({
      model: this.model,
      voice: this.voice,
      input: text,
    });

    return {
      buffer: await response.arrayBuffer().then(Buffer.from),
      format: "mp3",
    };
  }
}
