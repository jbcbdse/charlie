import { JestConfigWithTsJest } from "ts-jest";
import baseConfig from "../../jest.config";

const jestConfig: JestConfigWithTsJest = {
  ...baseConfig,
  rootDir: "./src",
  passWithNoTests: true,
};
export default jestConfig;
