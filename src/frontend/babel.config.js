/**
 * Babel configuration for GUI-LOP Frontend.
 *
 * Kept intentionally lean: CRA (`react-scripts`) brings its own Babel
 * configuration via `babel-preset-react-app`; this file only adds an
 * extra-narrow override path for tools that load Babel directly
 * (e.g. workbox-build during the production bundle step).
 */

module.exports = {
  presets: [
    require.resolve('babel-preset-react-app'),
  ],
};
