import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@ats/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@ats/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  // Integration tests share a DB, run sequentially
  maxWorkers: 1,
};

export default config;
