import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**/*.cjs",
  ]),
  {
    rules: {
      // Canonical app uses common Firebase / tab sync patterns; flagging every
      // synchronous setState in an effect is too strict for this codebase.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
