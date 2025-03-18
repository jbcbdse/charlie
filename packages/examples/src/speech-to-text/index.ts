import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { AWSStreamingTranscriber } from "@jbcbdse/charlie-bedrock";
import { WhisperTranscriber } from "@jbcbdse/charlie-openai";

dotenv.config({ path: "../../.env" });

const audioDirectory = path.join("/home/jonb/tmp/audio-recordings");

const audioFiles = [
  "speech-1742160234474-1742160235001.wav",
  "speech-1742160244747-1742160244833.wav",
];

const logger = console;

logger.log(audioFiles);

async function main() {
  const openaiTranscriber = new WhisperTranscriber({
    apiKey: process.env.OPENAI_API_KEY || "",
  });
  const awsTranscriber = new AWSStreamingTranscriber({});
  for (const file of audioFiles) {
    try {
      logger.log(`Transcribing ${file}...`);
      const response = await awsTranscriber.transcribe({
        file: fs.createReadStream(path.join(audioDirectory, file)),
      });
      logger.log(`AWS Transcription for ${file}:`, response.text);
    } catch (error) {
      logger.error(`Error transcribing ${file}:`, error);
    }

    const openaiResponse = await openaiTranscriber.transcribe({
      file: fs.createReadStream(path.join(audioDirectory, file)),
    });
    logger.log(`OpenAI Transcription for ${file}:`, openaiResponse.text);
  }
}

main();
