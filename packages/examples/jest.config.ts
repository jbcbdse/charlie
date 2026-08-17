import { JestConfigWithTsJest } from "ts-jest";
import baseConfig from "../../jest.config";

const jestConfig: JestConfigWithTsJest = {
  ...baseConfig,
  rootDir: "./src",
  testPathIgnorePatterns: ["/e2e/"],
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.test.json",
    },
  },
};
export default jestConfig;
