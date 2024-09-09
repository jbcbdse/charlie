import { createDefaultPreset, JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
  rootDir: "./src",
  collectCoverage: true,
  testMatch: ["<rootDir>/**/*.spec.ts"],
  ...createDefaultPreset(),
  maxWorkers: 4,
};
export default jestConfig;
