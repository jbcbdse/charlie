// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPrettierPluginRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPrettierPluginRecommended, // ignore the squiggle. It works
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "warn",
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },
);
