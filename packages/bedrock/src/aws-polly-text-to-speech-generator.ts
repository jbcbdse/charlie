import { TextToSpeechGenerator } from "@jbcbdse/charlie-core";
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  OutputFormat,
  TextType,
  VoiceId,
} from "@aws-sdk/client-polly";

/**
 * Configuration options for AWS Polly text-to-speech generator
 */
export interface AWSPollyTextToSpeechOptions {
  /** AWS region (default: "us-east-1") */
  region?: string;

  /** Voice to use (default: Joanna) */
  voiceId?: VoiceId;

  /** Engine type (default: NEURAL) */
  engine?: Engine;

  /** Output format (default: MP3) */
  format?: OutputFormat;

  /** Text type (default: TEXT) */
  textType?: TextType;
}

/**
 * Text-to-speech generator using AWS Polly
 * Supports multiple voices, engines, and formats
 */
export class AWSPollyTextToSpeechGenerator implements TextToSpeechGenerator {
  private client: PollyClient;
  private voiceId: VoiceId;
  private engine: Engine;
  private format: OutputFormat;
  private textType: TextType;

  constructor(options: AWSPollyTextToSpeechOptions) {
    this.client = new PollyClient({
      region: options.region || "us-east-1",
    });
    this.voiceId = options.voiceId || VoiceId.Joanna;
    this.engine = options.engine || Engine.NEURAL;
    this.format = options.format || OutputFormat.MP3;
    this.textType = options.textType || TextType.TEXT;
  }

  /**
   * Generates speech from text using AWS Polly
   *
   * @param text The text to convert to speech
   * @returns Object containing the audio buffer and format
   */
  async generate(text: string): Promise<{ buffer: Buffer; format: string }> {
    const response = await this.client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        VoiceId: this.voiceId,
        Engine: this.engine,
        OutputFormat: this.format,
        TextType: this.textType,
      }),
    );

    // Convert the audio stream to a buffer
    if (!response.AudioStream) {
      throw new Error("No audio stream returned from AWS Polly");
    }

    // Use a type assertion to access the body as a Uint8Array
    // AWS SDK v3 provides different stream types in browser vs Node environments
    // We'll use a method that works in Node.js and handle the stream safely
    const audioData = await response.AudioStream.transformToByteArray();
    const buffer = Buffer.from(audioData);

    return {
      buffer,
      format: this.format.toLowerCase(),
    };
  }
}
