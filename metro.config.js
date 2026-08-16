const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// tronweb's package.json "main" points at a Node-only build (dist/TronWeb.node.js)
// that requires Node's real "crypto" module, which doesn't exist in React Native,
// and it ships no "browser" field to fall back to. Metro resolves "tronweb"
// successfully via normal node_modules lookup, so extraNodeModules (a fallback
// for modules that CAN'T otherwise be found) never gets consulted. We have to
// intercept resolution directly and redirect it to the browser-safe bundle.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tronweb') {
    return {
      filePath: require.resolve('tronweb/dist/TronWeb.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
