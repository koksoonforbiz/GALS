module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [require.resolve('@ats/config/eslint'), 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'public'],
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
};
