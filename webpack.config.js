const path = require('path');
const webpack = require('webpack');
const { getIfUtils, removeEmpty } = require('webpack-config-utils');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const nodeEnv = process.env.NODE_ENV || 'development';
const { ifDevelopment, ifProduction } = getIfUtils(nodeEnv);

const PATHS = {
  entry: path.resolve(__dirname, 'client/index.ts'),
  bundles: path.resolve(__dirname, '_bundles'),
};

const babelOptions = {
  presets: [
    [
      'env', {
        'modules': false
      }
    ]
  ],
  plugins: [
    'transform-runtime',
    'transform-object-rest-spread'
  ]
}

module.exports = removeEmpty({
  entry: ifProduction({
    'mighty-socket-client': PATHS.entry,
    'mighty-socket-client.min': PATHS.entry
  }, './example/client/index.ts'),

  output: {
    filename: ifProduction('[name].js', '[name]-[hash].js'),
    library:  ifProduction('MightySocketClient'),
    libraryTarget: ifProduction('umd'),
    // umdNamedDefine: true,
    path: ifProduction(PATHS.bundles, path.resolve(__dirname, 'public')),
  },

  module: {
    rules: [
      {
        test: /\.(sass|scss)$/,
        loader: ExtractTextPlugin.extract({
          fallback: 'style-loader',
          use: ['css-loader', 'sass-loader'],
        }),
      },
      {
        test: /\.css$/,
        loader: ExtractTextPlugin.extract({
          fallback: 'style-loader',
          use: ['css-loader'],
        }),
      },
      {
        test: /\.ts(x?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: babelOptions
          },
          {
            loader: 'ts-loader',
            // exclude: /node_modules/,
            query: {
              transpileOnly: true
            }
          }
        ]
      },
      // {
      //   test: /\.js$/,
      //   exclude: /node_modules/,
      //   use: [
      //     {
      //       loader: 'babel-loader',
      //       options: babelOptions
      //     }
      //   ]
      // }
    ],
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json']
  },

  devtool: ifDevelopment('eval-source-map', 'source-map'),

  devServer: ifDevelopment({
    host: '0.0.0.0',
    port: 3000,
    stats: 'normal',
    open: true,
    overlay: true
  }),

  plugins: removeEmpty([
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify(nodeEnv),
      },
    }),

    ifDevelopment(
      new HtmlWebpackPlugin({
        hash: true,
        filename: 'index.html',
        template: './example/client/index.ejs',
        inject: false,
        environment: nodeEnv,
      })
    ),

    // ifProduction(new CopyWebpackPlugin([{ from: 'assets', to: 'assets' }])),

    ifProduction(
      new ExtractTextPlugin('[name]-bundle-[hash].css'),
      new ExtractTextPlugin('[name]-bundle.css')
    ),

    ifProduction(
      new webpack.optimize.UglifyJsPlugin({
        minimize: true,
        sourceMap: true,
        include: /\.min\.js$/,
      })
    )
  ]),
});