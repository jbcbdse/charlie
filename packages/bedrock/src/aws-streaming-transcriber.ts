import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import { Transcriber } from "@jbcbdse/charlie-core";
import type * as fs from "fs";

interface AudioStream {
  AudioEvent: { AudioChunk: Uint8Array };
}
/**
 * This transcriber return a Promise, not a stream, but uses the streaming API instead of the batch API
 */
export class AWSStreamingTranscriber implements Transcriber {
  private client: TranscribeStreamingClient;

  constructor(options: {
    region?: string;
    client?: TranscribeStreamingClient;
  }) {
    this.client =
      options.client ||
      new TranscribeStreamingClient({
        region: options.region ?? "us-east-1",
      });
  }

  async transcribe(options: {
    file: fs.ReadStream;
  }): Promise<{ text: string }> {
    // Convert ReadStream to AsyncIterable of audio chunks
    const audioStream = this.createAudioStream(options.file);

    const response = await this.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US", // or use auto language identification
        MediaEncoding: "pcm", // adjust based on your audio format
        MediaSampleRateHertz: 16000, // adjust based on your audio
        AudioStream: audioStream as unknown as AsyncIterable<AudioStream>,
      }),
    );

    // Process the streaming response
    let transcription = "";
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for await (const event of response.TranscriptResultStream!) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          console.log(result);
          if (result.IsPartial === false) {
            if (result.Alternatives && result.Alternatives.length > 0) {
              transcription = `${transcription} ${result.Alternatives[0].Transcript}`;
            }
          }
        }
      }
    }

    return {
      text: transcription.trim(),
    };
  }

  private createAudioStream(
    readStream: fs.ReadStream,
  ): AsyncIterable<AudioStream> {
    // Maximum chunk size in bytes (8KB is a good starting point)
    const MAX_CHUNK_SIZE = 8 * 1024;

    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of readStream) {
          // Break large chunks into smaller ones
          const buffer = chunk instanceof Buffer ? chunk : Buffer.from(chunk);

          // Process the buffer in smaller chunks
          for (let i = 0; i < buffer.length; i += MAX_CHUNK_SIZE) {
            const slicedChunk = buffer.subarray(i, i + MAX_CHUNK_SIZE);
            yield {
              AudioEvent: {
                AudioChunk: slicedChunk,
              },
            };

            // Small delay to avoid overwhelming the service
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      },
    };
  }
}
