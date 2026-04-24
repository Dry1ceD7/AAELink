import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['.next/', 'node_modules/'],
  },
  {
    files: ['*.mjs', '*.cjs', '*.config.{js,mjs,cjs,ts}', 'i18n/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
)
