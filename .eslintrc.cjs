/* eslint-env node */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,
  overrides: [{
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    files: ['*.ts'],
    rules: {
      'no-console': 'error',
    },
  }],
  env: {
    browser: true,
    node: true,
  },
};
