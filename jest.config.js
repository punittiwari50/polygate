module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  projects: [
    {
      displayName: "core",
      testMatch: ["<rootDir>/packages/core/src/__tests__/**/*.test.ts"],
      moduleNameMapper: {
        "^@/(.*)\\.js$": "<rootDir>/packages/core/src/$1.ts",
        "^@/(.*)$": "<rootDir>/packages/core/src/$1",
        "^(\\.\\.?\\/.+)\\.js$": "$1"
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "packages/core/tsconfig.json" }]
      }
    },
    {
      displayName: "persistence",
      testMatch: ["<rootDir>/packages/persistence/src/__tests__/**/*.test.ts"],
      moduleNameMapper: {
        "^@/(.*)\\.js$": "<rootDir>/packages/persistence/src/$1.ts",
        "^@/(.*)$": "<rootDir>/packages/persistence/src/$1",
        "^(\\.\\.?\\/.+)\\.js$": "$1"
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "packages/persistence/tsconfig.json" }]
      }
    },
    {
      displayName: "gateway-server",
      testMatch: ["<rootDir>/packages/gateway-server/src/__tests__/**/*.test.ts"],
      moduleNameMapper: {
        "^@/(.*)\\.js$": "<rootDir>/packages/gateway-server/src/$1.ts",
        "^@/(.*)$": "<rootDir>/packages/gateway-server/src/$1",
        "^(\\.\\.?\\/.+)\\.js$": "$1"
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "packages/gateway-server/tsconfig.json" }]
      }
    },
    {
      displayName: "cli",
      testMatch: ["<rootDir>/packages/cli/src/__tests__/**/*.test.ts"],
      moduleNameMapper: {
        "^@/(.*)\\.js$": "<rootDir>/packages/cli/src/$1.ts",
        "^@/(.*)$": "<rootDir>/packages/cli/src/$1",
        "^(\\.\\.?\\/.+)\\.js$": "$1"
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "packages/cli/tsconfig.json" }]
      }
    }
  ]
};
