// Icons in tests: every name is an empty component (the icons are not what the tests look at).
const Icon = () => null;
module.exports = new Proxy({ __esModule: true }, { get: (target, name) => (name in target ? target[name] : Icon) });
