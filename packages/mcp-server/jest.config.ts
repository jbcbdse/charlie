import { JestConfigWithTsJest } from "ts-jest";
import baseConfig from "../../jest.config";

const jestConfig: JestConfigWithTsJest = {
  ...baseConfig,
  rootDir: "./src",
  testTimeout: 30000,
};
export default jestConfig;
