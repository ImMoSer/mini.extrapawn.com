import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import boundaries from "eslint-plugin-boundaries";
import pluginVue from "eslint-plugin-vue";
import { globalIgnores } from "eslint/config";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: [
      "src/**/*.{ts,mts,tsx,vue}",
      "eslint.config.ts",
      "vite.config.ts",
    ],
  },

  globalIgnores(["**/dist/**", "**/coverage/**", "public/**"]),

  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-object-type": "off",
      "vue/multi-word-component-names": "off",
    },
  },

  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "src/app/*" },
        { type: "pages", pattern: "src/pages/*" },
        { type: "widgets", pattern: "src/widgets/*" },
        {
          type: "features",
          pattern: "src/features/*",
          capture: ["featureName"],
        },
        {
          type: "entities",
          pattern: "src/entities/*",
          capture: ["entityName"],
        },
        { type: "shared", pattern: "src/shared/*" },
      ],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.app.json",
        },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message: "{{file.type}} is not allowed to import {{dependency.type}}",
          policies: [
            {
              from: { element: { type: "shared" } },
              allow: { to: { element: { type: "shared" } } },
            },
            {
              from: { element: { type: "entities" } },
              allow: [
                { to: { element: { type: "shared" } } },
                {
                  to: {
                    element: {
                      type: "entities",
                      captured: { entityName: "{{from.entityName}}" },
                    },
                  },
                },
              ],
            },
            {
              from: { element: { type: "features" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "entities" } } },
                {
                  to: {
                    element: {
                      type: "features",
                      captured: { featureName: "{{from.featureName}}" },
                    },
                  },
                },
              ],
            },
            {
              from: { element: { type: "widgets" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "entities" } } },
                { to: { element: { type: "features" } } },
                { to: { element: { type: "widgets" } } },
              ],
            },
            {
              from: { element: { type: "pages" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "entities" } } },
                { to: { element: { type: "features" } } },
                { to: { element: { type: "widgets" } } },
                { to: { element: { type: "pages" } } },
              ],
            },
            {
              from: { element: { type: "app" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "entities" } } },
                { to: { element: { type: "features" } } },
                { to: { element: { type: "widgets" } } },
                { to: { element: { type: "pages" } } },
                { to: { element: { type: "app" } } },
              ],
            },
          ],
        },
      ],
    },
  },

  skipFormatting
);

