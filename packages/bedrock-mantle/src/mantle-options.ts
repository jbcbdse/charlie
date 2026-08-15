import { getTokenProvider } from "@aws/bedrock-token-generator";

export interface MantleAuthOptions {
  region?: string;
  profile?: string;
  apiKey?: string | (() => Promise<string>);
}

export function resolveMantleRegion(options: { region?: string } = {}): string {
  return (
    options.region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

export function resolveMantleProfile(
  options: { profile?: string } = {},
): string | undefined {
  return options.profile || process.env.AWS_PROFILE || undefined;
}

export function bedrockMantleBaseURL(
  path: "v1" | "openai/v1" | "anthropic" = "v1",
  region?: string,
): string {
  return `https://bedrock-mantle.${resolveMantleRegion({ region })}.api.aws/${path}`;
}

export function resolveMantleApiKey(
  options: MantleAuthOptions,
): string | (() => Promise<string>) {
  if (options.apiKey !== undefined) {
    return options.apiKey;
  }
  const envKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (envKey) {
    return envKey;
  }
  const region = resolveMantleRegion(options);
  const profile = resolveMantleProfile(options);
  return getTokenProvider({ region, ...(profile ? { profile } : {}) });
}
