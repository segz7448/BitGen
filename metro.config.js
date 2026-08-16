const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// tronweb's package.json "main" points at a Node-only build (dist/TronWeb.node.js)
// that requires Node's real "crypto" module, which doesn't exist in React Native.
// It has no "browser" field to fall back to, so we alias it straight to the
// browser-safe bundle it ships at dist/TronWeb.js.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  tronweb: require.resolve('tronweb/dist/TronWeb.js'),
};

module.exports = config;
