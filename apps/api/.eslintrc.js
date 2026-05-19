module.exports = {
  extends: [require.resolve('@ats/config/eslint')],
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.js'],
};
