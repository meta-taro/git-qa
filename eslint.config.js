import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      // Rust のビルド成果物と Tauri の生成物。生成された JS が混ざるので検査対象から外す。
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      // 配布物に入れる Node 側の束ね（生成物）。
      '**/src-tauri/resources/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // ルート直下の設定ファイルは、どのパッケージの tsconfig にも属さない。
          // 型情報なしで見るために既定プロジェクト扱いにする。
          // スパイクは使い捨てで、どのパッケージにも属さない。**検査対象から外さない**
          // （捨てるコードでも、壊れたまま残っていれば次に読む人が信じてしまう）。
          // `**` は許されない（既定プロジェクト扱いが広がりすぎるため）。階層を明示する。
          allowDefaultProject: ['*.config.ts', 'spikes/*/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 未使用でも意図的に残す引数は _ 始まりで明示する。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 握り潰しの検出（product-baseline §8）。理由があるなら明示的に書く。
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['spikes/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', URL: 'readonly', process: 'readonly' },
    },
  },
);
