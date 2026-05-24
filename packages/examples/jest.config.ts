import { JestConfigWithTsJest } from "ts-jest";
import baseConfig from "../../jest.config";

const jestConfig: JestConfigWithTsJest = {
  ...baseConfig,
  rootDir: "./src",
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.test.json",
    },
  },
};
export default jestConfig;
