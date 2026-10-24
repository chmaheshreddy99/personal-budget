module.exports = {
  preset: '@react-native/jest-preset',
  // the icons ship as ES modules: tests use a stub (__mocks__/lucide-react-native.js)
  moduleNameMapper: { '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js' },
};
