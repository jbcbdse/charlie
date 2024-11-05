// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPrettierPluginRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  eslint.configs.recommended,
  eslintPrettierPluginRecommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    ignores: ["dist/**/*"],
  },
  {
    rules: {
      "no-console": "warn",
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },
);
