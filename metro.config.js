const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// bitcoinjs-lib/bip32/ethers/tronweb pull in Node core modules (stream, crypto,
// http, https, os, path, zlib, url, assert, util, vm) via packages like
// cipher-base, hash-base, etc. React Native has no Node core modules, so these
// must be mapped to their browserify polyfills, which are already installed as
// dependencies but were never wired into the resolver.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  stream: require.resolve('stream-browserify'),
  crypto: require.resolve('crypto-browserify'),
  http: require.resolve('stream-http'),
  https: require.resolve('https-browserify'),
  os: require.resolve('os-browserify'),
  path: require.resolve('path-browserify'),
  zlib: require.resolve('browserify-zlib'),
  url: require.resolve('url'),
  assert: require.resolve('assert'),
  util: require.resolve('util'),
  vm: require.resolve('vm-browserify'),
  buffer: require.resolve('buffer'),
  events: require.resolve('events'),
  process: require.resolve('process'),
};

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
