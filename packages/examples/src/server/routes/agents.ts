import { Request, Response } from "express";

export type AvailableAgent =
  | "claude"
  | "mistral"
  | "commandr"
  | "llama"
  | "jamba-large"
  | "nova"
  | "titan"
  | "gpt4o"
  | "grok"
  | "gemini"
  | "bedrock-mantle";

export function agentsHandler(availableAgents: AvailableAgent[]) {
  return (_req: Request, res: Response) => {
    res.json({ agents: availableAgents });
  };
}
