module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    modulePathIgnorePatterns: ["<rootDir>/.history/"],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
