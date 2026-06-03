module.exports = {
  extends: [require.resolve('@ats/config/eslint')],
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  // prisma/scripts/* are standalone ts-node maintenance scripts kept
  // outside tsconfig.json's `include`, so the typed-linting parser
  // can't find them. Skip lint on that directory.
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.js', 'prisma/scripts/'],
};
