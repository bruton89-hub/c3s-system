module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated v4 delegates to react-native-worklets/plugin.
      // The reanimated plugin re-exports it, so either path works — using the
      // reanimated entry so the name stays familiar.
      'react-native-reanimated/plugin',
    ],
  };
};
