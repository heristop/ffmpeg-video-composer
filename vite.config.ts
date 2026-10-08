import { defineConfig } from 'vite-plus';

// Unified Vite+ lint configuration for the whole monorepo.
// Replaces the per-package .oxlintrc.json files and runs via `vp lint`.
// The local JS plugin (./scripts/oxlint-plugin-local.ts) is loaded through
// lint.jsPlugins and exposes the `local/*` rules.
export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: true,
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    trailingComma: 'es5',
    bracketSpacing: true,
    sortPackageJson: false,
    ignorePatterns: ['pnpm-lock.yaml', 'dist/**', '**/dist/**', 'coverage/**'],
  },
  // Staged-file checks for the pre-commit hook (replaces lint-staged).
  // Run via `vp staged`.
  staged: {
    '*.{ts,tsx,js,cjs,mjs,json,md,yml,yaml}': 'vp fmt',
    '*.{ts,tsx}': 'vp lint',
    // Block commits that introduce a circular / forbidden module dependency. A function task (not a
    // string) so the staged filenames are NOT appended — depcruise cruises the whole core graph (which
    // follows into creative-kit, where such cycles surface), not a file list. Static analysis only, so
    // it's fast. Scoped to the two packages the graph covers, so unrelated commits skip it.
    'packages/{ffmpeg-video-composer,creative-kit}/**/*.{ts,tsx}': () => 'pnpm deps:check',
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'import', 'oxc', 'react'],
    jsPlugins: ['./scripts/oxlint-plugin-local.ts'],
    ignorePatterns: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'build/**',
      '**/.expo/**',
      '**/e2e/**',
      '**/playwright.config.ts',
      // PR media recorders: one-off Playwright drivers, like the e2e specs.
      '.github/pr-media/**',
      'scripts/ffmpeg/.work/**',
      // Optional adapter requires an operator-staged private companion repository.
      'examples/llm-remotion-title/remotion/BrandMotionPromo.tsx',
      'examples/llm-remotion-title/remotion/brand-motion-index.tsx',
      'examples/llm-remotion-title/remotion/brand-motion-kit/**',
    ],
    env: {
      node: true,
      es2024: true,
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // --- Correctness / suspicious (eslint core) ---
      'no-global-assign': 'error',
      'no-import-assign': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-new-native-nonconstructor': 'error',
      'no-nonoctal-decimal-escape': 'error',
      'no-obj-calls': 'error',
      'no-script-url': 'error',
      'no-self-assign': 'error',
      'no-setter-return': 'error',
      'no-shadow-restricted-names': 'error',
      'no-sparse-arrays': 'error',
      'no-this-before-super': 'error',
      'no-unassigned-vars': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-expressions': 'error',
      'no-unused-labels': 'error',
      'no-unused-private-class-members': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-useless-backreference': 'error',
      'no-useless-catch': 'error',
      'no-useless-escape': 'error',
      'no-useless-rename': 'error',
      'no-with': 'error',
      'no-void': 'error',
      'require-yield': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // --- oxc ---
      'oxc/bad-array-method-on-arguments': 'error',
      'oxc/bad-char-at-comparison': 'error',
      'oxc/bad-comparison-sequence': 'error',
      'oxc/bad-min-max-func': 'error',
      'oxc/bad-object-literal-comparison': 'error',
      'oxc/bad-replace-all-arg': 'error',
      'oxc/const-comparisons': 'error',
      'oxc/double-comparisons': 'error',
      'oxc/erasing-op': 'error',
      'oxc/missing-throw': 'error',
      'oxc/number-arg-out-of-range': 'error',
      'oxc/only-used-in-recursion': 'error',
      'oxc/uninvoked-array-callback': 'error',

      // --- typescript (type-aware) ---
      'typescript/await-thenable': 'error',
      'typescript/no-array-delete': 'error',
      'typescript/no-base-to-string': 'error',
      'typescript/no-duplicate-enum-values': 'error',
      'typescript/no-duplicate-type-constituents': 'error',
      'typescript/no-extra-non-null-assertion': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-for-in-array': 'error',
      'typescript/no-implied-eval': 'error',
      'typescript/no-meaningless-void-operator': 'error',
      'typescript/no-misused-new': 'error',
      'typescript/no-misused-spread': 'error',
      'typescript/no-non-null-asserted-optional-chain': 'error',
      'typescript/no-redundant-type-constituents': 'error',
      'typescript/no-this-alias': 'error',
      'typescript/no-unnecessary-parameter-property-assignment': 'error',
      'typescript/no-unsafe-declaration-merging': 'error',
      'typescript/no-unsafe-unary-minus': 'error',
      'typescript/no-useless-empty-export': 'error',
      'typescript/no-wrapper-object-types': 'error',
      'typescript/prefer-as-const': 'error',
      'typescript/require-array-sort-compare': 'error',
      'typescript/restrict-template-expressions': 'error',
      'typescript/triple-slash-reference': 'error',
      'typescript/unbound-method': 'error',
      'typescript/no-explicit-any': 'error',

      // --- import ---
      'import/no-duplicates': 'error',

      // --- unicorn (correctness) ---
      'unicorn/no-await-in-promise-methods': 'error',
      'unicorn/no-empty-file': 'error',
      'unicorn/no-invalid-fetch-options': 'error',
      'unicorn/no-invalid-remove-event-listener': 'error',
      'unicorn/no-new-array': 'error',
      'unicorn/no-single-promise-in-promise-methods': 'error',
      'unicorn/no-thenable': 'error',
      'unicorn/no-unnecessary-await': 'error',
      'unicorn/no-useless-fallback-in-spread': 'error',
      'unicorn/no-useless-length-check': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/prefer-set-size': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',

      // --- complexity / size budgets ---
      complexity: ['error', 12],
      'max-lines-per-function': [
        'error',
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-params': ['error', 5],
      'max-statements': ['error', 20],
      'max-nested-callbacks': ['error', 3],
      'max-depth': ['error', 4],
      'import/max-dependencies': ['error', 21],
      'max-lines': [
        'error',
        {
          max: 300,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // --- style / best practices ---
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      // Free/module-level functions use `function` declarations (hoisted, top-down readable, named in
      // stack traces); arrow functions stay for `this`-bound class fields and inline callbacks, which
      // this rule does not touch. Disabled for the React apps,
      // where `const Component = () => <jsx>` is the idiom.
      'func-style': ['error', 'declaration'],
      // Surface stray TODO/FIXME/XXX comments so Sonar doesn't catch them
      // first. The list is the SonarQube set so the two stay aligned.
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'start' }],
      'no-implicit-coercion': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-negated-condition': 'error',
      'no-nested-ternary': 'error',
      'no-else-return': 'error',
      curly: ['error', 'multi-line'],
      'no-alert': 'error',
      'no-param-reassign': [
        'error',
        {
          props: false,
        },
      ],
      'no-return-assign': 'error',
      'default-case': 'error',
      'default-case-last': 'error',
      'guard-for-in': 'error',
      'no-await-in-loop': 'error',
      'no-extend-native': 'error',
      'no-loop-func': 'error',
      'no-new-wrappers': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-rest-params': 'error',
      radix: 'error',
      'symbol-description': 'error',
      yoda: 'error',

      // --- typescript (style / type-aware) ---
      'typescript/no-unnecessary-condition': 'error',
      'typescript/prefer-nullish-coalescing': 'error',
      'typescript/prefer-optional-chain': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/consistent-type-imports': 'error',
      'typescript/consistent-return': 'error',
      'typescript/no-confusing-non-null-assertion': 'error',
      'typescript/no-confusing-void-expression': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-unnecessary-boolean-literal-compare': 'error',
      'typescript/no-unnecessary-template-expression': 'error',
      'typescript/no-unnecessary-type-arguments': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
      'typescript/prefer-readonly': 'error',
      'typescript/no-unnecessary-type-conversion': 'error',
      'typescript/no-unnecessary-qualifier': 'error',
      'typescript/prefer-for-of': 'error',
      'typescript/prefer-includes': 'error',
      'typescript/prefer-promise-reject-errors': 'error',
      'typescript/no-deprecated': 'error',

      // --- react ---
      'react/no-children-prop': 'error',
      'react/no-danger': 'error',
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],

      // --- unicorn (style) ---
      'unicorn/catch-error-name': [
        'error',
        {
          name: 'error',
        },
      ],
      'unicorn/explicit-length-check': 'error',
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-console-spaces': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-spread': 'error',
      'unicorn/no-useless-promise-resolve-reject': 'error',
      'unicorn/no-useless-switch-case': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-array-flat': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-event-target': 'error',
      'unicorn/prefer-includes': 'error',
      // Off: the codebase sorts via the non-mutating `[...arr].sort()` idiom (the
      // spread copies first, so nothing is mutated) because `Array#toSorted()` is
      // not guaranteed on the React Native (Hermes) runtime.
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'error',

      // --- carried over from the previous .oxlintrc.json ---
      'typescript/dot-notation': 'error',
      'no-proto': 'error',
      'no-redeclare': 'error',
      'no-constant-condition': 'warn',
      'no-duplicate-imports': 'error',
      'import/no-cycle': 'error',
      'import/named': 'error',
      'unicorn/prefer-code-point': 'warn',
      'unicorn/prefer-string-raw': 'warn',
      'unicorn/prefer-top-level-await': 'off',

      // --- local JS plugin ---
      'local/no-else-clause': 'error',
      'local/no-disable-comments': 'error',
      'local/padding-line-before-statements': 'warn',
    },
    overrides: [
      {
        files: ['**/*.test.ts', '**/*.spec.ts'],
        env: {
          jest: true,
          node: true,
        },
        rules: {
          'typescript/no-explicit-any': 'off',
          'max-lines-per-function': 'off',
          'max-lines': 'off',
          'max-statements': 'off',
          'max-nested-callbacks': 'off',
          complexity: 'off',
          'no-await-in-loop': 'off',
          // Test ergonomics: explicit undefined args, mock method refs, casts and
          // void-returning assertions are idiomatic in specs and not worth fighting.
          'unicorn/no-useless-undefined': 'off',
          'typescript/unbound-method': 'off',
          'typescript/no-confusing-void-expression': 'off',
          'typescript/no-non-null-assertion': 'off',
          'typescript/no-unnecessary-type-assertion': 'off',
          'local/padding-line-before-statements': 'off',
          'unicorn/prefer-spread': 'off',
          'unicorn/no-array-sort': 'off',
          'unicorn/catch-error-name': 'off',
          // Mock factories and per-case fixture builders are idiomatic as arrow consts in specs; the
          // function-declaration convention applies to shipped package source, not test scaffolding.
          'func-style': 'off',
        },
      },
      {
        // The installed native renderer exercises component lifecycle and async state isolation.
        // Keep this compatibility allowance limited to these component regressions.
        files: [
          'apps/leclap-expo/src/features/editor/components/ExportSheet.test.ts',
          'apps/leclap-expo/src/features/editor/preview/PreviewPage.test.ts',
          'apps/leclap-expo/src/features/captions/captions-panel.test.ts',
          'apps/leclap-expo/src/components/clappy/clappy-motion.test.ts',
          'apps/leclap-expo/src/hooks/use-motion-preferences.test.ts',
        ],
        rules: { 'typescript/no-deprecated': 'off' },
      },
      {
        // This .test.ts component suite supplies children without JSX.
        files: ['apps/leclap-expo/src/components/clappy/clappy-motion.test.ts'],
        rules: { 'react/no-children-prop': 'off' },
      },
      {
        // Build/codegen scripts and Cucumber step definitions are tooling, not shipped package
        // source — exempt from the function-declaration convention.
        files: ['scripts/**', '**/scripts/**', '**/features/**'],
        rules: {
          'func-style': 'off',
        },
      },

      // --- Per-package rule overrides ------------------------------------------------------
      // Each workspace package gets a dedicated slot so it can tune lint rules independently of
      // the shared defaults above, without touching another package's config. Add package-local
      // rule entries inside the matching block (more specific file overrides further below still
      // win, since oxlint applies later overrides last).
      {
        // ffmpeg-video-composer (Node library)
        files: ['packages/ffmpeg-video-composer/**'],
        env: { node: true, es2024: true },
        rules: {},
      },
      {
        // leclap-web (React + Vite browser app)
        files: ['apps/leclap-web/**'],
        plugins: ['typescript', 'unicorn', 'import', 'oxc', 'react'],
        env: { browser: true, es2024: true },
        rules: {
          // Screens/components legitimately run long; the file/function size budgets are kept
          // strict for the library (packages/**) but relaxed for the UI layer.
          'max-lines': 'off',
          'max-lines-per-function': 'off',
          // `const Component = () => <jsx>` is the React idiom — do not force declarations here.
          'func-style': 'off',
        },
      },
      {
        // leclap-expo (React Native / Expo app)
        files: ['apps/leclap-expo/**'],
        plugins: ['typescript', 'unicorn', 'import', 'oxc', 'react'],
        env: { browser: true, es2024: true },
        rules: {
          'max-lines': 'off',
          'max-lines-per-function': 'off',
          // React Native / Metro require static `require()` for asset modules and lazy native
          // modules — you cannot ES-import a Metro-bundled asset. `prefer-module` does not apply
          // to the RN runtime, so it is disabled app-wide for the Expo package.
          'unicorn/prefer-module': 'off',
          // `const Component = () => <jsx>` is the React idiom — do not force declarations here.
          'func-style': 'off',
        },
      },
      // -------------------------------------------------------------------------------------

      {
        files: [
          'packages/ffmpeg-video-composer/src/platform/filesystem/BrowserFilesystemAdapter.ts',
          'packages/ffmpeg-video-composer/src/browser.ts',
        ],
        env: {
          browser: true,
          es2024: true,
        },
      },
      {
        files: ['apps/**'],
        plugins: ['typescript', 'unicorn', 'import', 'oxc', 'react'],
        env: {
          browser: true,
          es2024: true,
        },
      },
      {
        files: ['**/metro.config.js'],
        env: {
          node: true,
          commonjs: true,
        },
        rules: {
          // Metro config must be CommonJS (require/__dirname/module.exports).
          'unicorn/prefer-module': 'off',
        },
      },
      {
        // tsyringe DI constructor legitimately injects 6 dependencies.
        files: ['packages/ffmpeg-video-composer/src/editor/VideoEditor.ts'],
        rules: {
          'max-params': 'off',
        },
      },
      {
        // A single ffmpeg.wasm instance can only run one exec at a time and the clips share one
        // mutable wasm FS, so the per-clip write -> exec -> read -> delete passes are strictly
        // sequential and cannot be parallelized. Promise.all would corrupt the shared FS.
        files: ['apps/leclap-web/src/**/videoEdits.ts'],
        rules: {
          'no-await-in-loop': 'off',
        },
      },
      {
        // Toolchain config files are declarative and not subject to size budgets.
        files: ['*.config.ts', '*.config.js'],
        rules: {
          'max-lines': 'off',
        },
      },
      {
        // The WASM<->MEMFS bridge adapter is inherently long and sits a few lines over budget,
        // largely due to the ffmpeg log/progress listeners the unit tests assert.
        files: ['packages/ffmpeg-video-composer/src/platform/ffmpeg/FFmpegWasmAdapter.ts'],
        rules: {
          'max-lines': 'off',
        },
      },
      {
        // Segment orchestration and the browser FS adapter both grew past the file budget with the
        // gradient-layer / caption / partials features; splitting either mid-pipeline buys little.
        files: [
          'packages/ffmpeg-video-composer/src/editor/SegmentBuilder.ts',
          'packages/ffmpeg-video-composer/src/platform/filesystem/BrowserFilesystemAdapter.ts',
        ],
        rules: {
          'max-lines': 'off',
        },
      },
      {
        // The admin TemplateEditor is the editor's composition root — it wires ~10 sub-panels, the
        // partial manager, services, and hooks together, so it legitimately sits over the dependency
        // and statement budgets that suit leaf modules.
        files: ['apps/leclap-web/src/presentation/components/admin/TemplateEditor.tsx'],
        rules: {
          'import/max-dependencies': 'off',
          'max-statements': 'off',
        },
      },
      {
        // On-device engine spike: uses Metro's static `require('../../assets/sample.mp4')` for the
        // bundled clip — a Metro asset import that `unicorn/prefer-module` would otherwise flag.
        files: ['apps/leclap-expo/app/**/ffmpeg-spike.tsx'],
        rules: {
          'unicorn/prefer-module': 'off',
        },
      },
      {
        // Generated data modules (e.g. creative-kit's templates.generated.ts from scripts/gen-templates.ts)
        // are machine-emitted, not hand-maintained, so the file/function size budgets don't apply.
        files: ['**/*.generated.ts'],
        rules: {
          'max-lines': 'off',
          'max-lines-per-function': 'off',
        },
      },
    ],
  },
});
