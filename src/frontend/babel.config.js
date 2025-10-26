/**
 * Babel configuration for GUI-LOP Frontend
 * Optimized for performance and bundle size
 */

module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          browsers: ['> 0.25%', 'not dead', 'not ie 11']
        },
        modules: false,
        useBuiltIns: 'usage',
        corejs: 3,
        debug: process.env.NODE_ENV === 'development'
      }
    ],
    [
      '@babel/preset-react',
      {
        runtime: 'automatic',
        development: process.env.NODE_ENV === 'development',
        importSource: {
          '@emotion/react': {
            sourceMap: false,
            autoLabel: 'never'
          }
        }
      }
    ]
  ],
  plugins: [
    // Remove console.log in production
    process.env.NODE_ENV === 'production' && [
      'transform-remove-console',
      {
        exclude: ['error', 'warn']
      }
    ],

    // Tree shaking support
    '@babel/plugin-syntax-dynamic-import',

    // Optimize imports
    [
      'babel-plugin-import',
      {
        libraryName: 'antd',
        libraryDirectory: 'es',
        style: true
      },
      'antd'
    ],

    // Code splitting
    '@babel/plugin-transform-runtime',

    // Prop types optimization
    process.env.NODE_ENV === 'production' && [
      'babel-plugin-transform-react-remove-prop-types',
      {
        removeImport: true
      }
    ]
  ].filter(Boolean),

  env: {
    development: {
      plugins: [
        // Fast refresh for development
        'react-refresh/babel'
      ]
    },
    production: {
      plugins: [
        // Additional production optimizations
        'babel-plugin-transform-react-constant-elements',
        'babel-plugin-transform-react-inline-elements'
      ]
    }
  }
};