import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "worker/runtime.d.ts", // Wrangler 自动生成的运行时声明
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // 全角空格（U+3000）是这个项目里对齐中文表格的正当手段——
      // 控制台报表、注释里的对照表都靠它。默认规则在模板串与注释里也拦，
      // 于是 lint 长期红着 47 条，而红着的 lint 等于没有 lint。
      //
      // 放开的只是模板串与注释，**代码本身照拦**：一个全角空格混进
      // 标识符或运算符之间是真事故，那种得报出来
      "no-irregular-whitespace": ["error", { skipTemplates: true, skipComments: true }],
    },
  },
]);

export default eslintConfig;
