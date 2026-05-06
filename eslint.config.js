import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["**/*.ts"],
  ignores: ["**/node_modules/**", "**/dist/**"],
  extends: [tseslint.configs.base],
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
