// Babel config for backend Jest runs (ESM source, CJS test sandbox).
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      { targets: { node: 'current' } },
    ],
  ],
};
