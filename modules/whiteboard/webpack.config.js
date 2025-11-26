const HtmlWebpackPlugin = require('html-webpack-plugin');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const path = require('path');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.js',
    mode: isProduction ? 'production' : 'development',
    devServer: {
      port: 3007,
      hot: true,
      historyApiFallback: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
      },
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      // Use environment variable for deployment URL, or explicit localhost for dev
      publicPath: (() => {
        if (process.env.PUBLIC_PATH) {
          // Remove any trailing/leading whitespace and ensure it ends with /
          const path = process.env.PUBLIC_PATH.trim();
          return path.endsWith('/') ? path : path + '/';
        }
        return isProduction ? '/' : 'http://localhost:3007/';
      })(),
      clean: true,
    },
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react'],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    plugins: [
      new ModuleFederationPlugin({
        name: 'whiteboardModule',
        filename: 'remoteEntry.js',
        exposes: {
          './App': './src/App',
        },
        shared: {
          react: { 
            singleton: true, 
            requiredVersion: '^18.2.0',
            eager: true, // Allow eager loading for standalone mode
            strictVersion: false,
          },
          'react-dom': { 
            singleton: true, 
            requiredVersion: '^18.2.0',
            eager: true, // Allow eager loading for standalone mode
            strictVersion: false,
          },
        },
      }),
      new HtmlWebpackPlugin({
        template: './public/index.html',
        minify: isProduction
          ? {
              removeComments: true,
              collapseWhitespace: true,
              removeRedundantAttributes: true,
              useShortDoctype: true,
              removeEmptyAttributes: true,
              removeStyleLinkTypeAttributes: true,
              keepClosingSlash: true,
              minifyJS: true,
              minifyCSS: true,
              minifyURLs: true,
            }
          : false,
      }),
    ],
    optimization: {
      splitChunks: isProduction
        ? {
            chunks: 'all',
            cacheGroups: {
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendors',
                priority: 10,
              },
            },
          }
        : false,
    },
  };
};

