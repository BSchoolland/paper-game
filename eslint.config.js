import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["**/*.ts"],
  // .claude/worktrees holds full repo copies whose tsconfigs make the parser's tsconfigRootDir
  // inference ambiguous (and we never want to lint them anyway).
  ignores: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  extends: [tseslint.configs.base],
  languageOptions: {
    parserOptions: {
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message:
          "Use the Rng class instead of Math.random. If raw access is intentional, add // eslint-disable-next-line no-restricted-syntax -- <reason>",
      },
      {
        selector:
          "AssignmentExpression[operator='='][right.operator='&'] BinaryExpression[operator='+'] BinaryExpression[operator='*'] Literal[value=1664525]",
        message:
          "Use the Rng class instead of inline LCG. If this is the Rng implementation itself, add // eslint-disable-next-line no-restricted-syntax",
      },
    ],
  },
});
