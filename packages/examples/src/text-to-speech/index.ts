import * as dotenv from "dotenv";
import * as fs from "fs";
import { OpenAITextToSpeechGenerator } from "@jbcbdse/charlie-openai";
import { AWSPollyTextToSpeechGenerator } from "@jbcbdse/charlie-bedrock";
import { VoiceId, Engine } from "@aws-sdk/client-polly";

dotenv.config({ path: "../../.env" });
const logger = console;

const phrase = "Peter Piper picked a peck of pickled peppers";

async function main() {
  // OpenAI TTS
  const openaiTTS = new OpenAITextToSpeechGenerator({
    apiKey: process.env.OPENAI_API_KEY || "",
    model: "tts-1",
    voice: "ash",
  });

  logger.log("Generating speech with OpenAI...");
  const openaiResponse = await openaiTTS.generate(phrase);
  fs.writeFileSync("openai-output.mp3", openaiResponse.buffer);
  logger.log("OpenAI speech saved to openai-output.mp3");

  // AWS Polly TTS
  const pollyTTS = new AWSPollyTextToSpeechGenerator({
    region: "us-east-1",
    voiceId: VoiceId.Arthur,
    engine: Engine.NEURAL,
  });

  logger.log("Generating speech with AWS Polly...");
  const pollyResponse = await pollyTTS.generate(phrase);
  fs.writeFileSync("polly-output.mp3", pollyResponse.buffer);
  logger.log("AWS Polly speech saved to polly-output.mp3");
}

main();
