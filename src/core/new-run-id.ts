import { v4 as uuid } from "uuid";
export function newRunId(): string {
  return uuid();
}
