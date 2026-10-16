module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.tsx'],
  transform: {'^.+\\.[jt]sx?$': 'babel-jest'},
  moduleNameMapper: {'^react$': '<rootDir>/node_modules/react','^react-native-video$': '<rootDir>/firetv/node_modules/react-native-video'},
  maxWorkers: 1,
};
