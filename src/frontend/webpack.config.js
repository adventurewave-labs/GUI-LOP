/**
 * Webpack configuration for GUI-LOP Frontend performance optimizations
 * Includes code splitting, compression, and bundle optimization
 */

const { override, addWebpackPlugin, overrideDevServer } = require('customize-cra');
const CompressionPlugin = require('compression-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { WorkboxWebpackPlugin } = require('workbox-webpack-plugin');

// Performance optimizations
const enableGzipBrotli = () => (config) => {
  config.plugins.push(
    new CompressionPlugin({
      algorithm: 'gzip',
      test: /\.(js|css|html|svg)$/,
      threshold: 8192,
      minRatio: 0.8
    })
  );

  config.plugins.push(
    new CompressionPlugin({
      filename: '[path][base].br',
      algorithm: 'brotliCompress',
      test: /\.(js|css|html|svg)$/,
      compressionOptions: {
        level: 11
      },
      threshold: 8192,
      minRatio: 0.8
    })
  );

  return config;
};

// Code splitting optimizations
const optimizeCodeSplitting = () => (config) => {
  config.optimization.splitChunks = {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        chunks: 'all',
        priority: 10,
        enforce: true
      },
      react: {
        test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
        name: 'react',
        chunks: 'all',
        priority: 20,
        enforce: true
      },
      router: {
        test: /[\\/]node_modules[\\/]react-router[\\/]/,
        name: 'router',
        chunks: 'all',
        priority: 15,
        enforce: true
      },
      common: {
        name: 'common',
        minChunks: 2,
        chunks: 'all',
        priority: 5,
        reuseExistingChunk: true
      }
    }
  };

  return config;
};

// Module resolution optimizations
const optimizeModuleResolution = () => (config) => {
  config.resolve.alias = {
    ...config.resolve.alias,
    '@components': 'src/components',
    '@pages': 'src/pages',
    '@hooks': 'src/hooks',
    '@utils': 'src/utils',
    '@services': 'src/services'
  };

  config.resolve.extensions = ['.mjs', '.js', '.jsx', '.json', '.ts', '.tsx'];

  return config;
};

// Bundle analyzer for development
const addBundleAnalyzer = () => (config) => {
  if (process.env.ANALYZE_BUNDLE) {
    config.plugins.push(new BundleAnalyzerPlugin({
      analyzerMode: 'server',
      analyzerPort: 8888,
      openAnalyzer: true
    }));
  }

  return config;
};

// Service Worker for caching
const addServiceWorker = () => (config) => {
  if (process.env.NODE_ENV === 'production') {
    config.plugins.push(
      new WorkboxWebpackPlugin.GenerateSW({
        clientsClaim: true,
        exclude: [/\.map$/, /_redirect/, /manifest\.json$/],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 365 * 24 * 60 * 60 // 365 days
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              }
            }
          },
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-resources',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              }
            }
          }
        ]
      })
    );
  }

  return config;
};

// Performance optimizations
const optimizePerformance = () => (config) => {
  // Enable tree shaking
  config.optimization.usedExports = true;
  config.optimization.sideEffects = false;

  // Minimize bundle size
  config.optimization.minimize = true;

  // Set environment variables for production
  if (process.env.NODE_ENV === 'production') {
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.REACT_APP_VERSION': JSON.stringify(process.env.npm_package_version || '1.0.0')
      })
    );
  }

  return config;
};

// Development server optimizations
const optimizeDevServer = () => (config) => {
  config.compress = true;
  config.hot = true;
  config.historyApiFallback = true;
  config.client.overlay = {
    warnings: false,
    errors: true
  };

  return config;
};

module.exports = override(
  optimizeCodeSplitting(),
  optimizeModuleResolution(),
  optimizePerformance(),
  enableGzipBrotli(),
  addBundleAnalyzer(),
  addServiceWorker()
);

module.exports.devServer = overrideDevServer(
  optimizeDevServer()
);