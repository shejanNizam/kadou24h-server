import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
    },
  },
);
