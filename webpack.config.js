const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Default dev-server port. 4173 sits in the frontend-tooling range without
// colliding with any IF or ChirpStack service:
//   ChirpStack admin UI      : 8080 (typical Docker-compose)
//   ChirpStack gRPC-Web API  : 8090 (typical Docker-compose)
//   Mosquitto MQTT           : 1883
//   Mosquitto WSS            : 9001
//   PostgreSQL               : 5432
//   Redis                    : 6379
//   React CRA default        : 3000
//   Vite default             : 5173
// Override at runtime: `PORT=4242 npm start`
const DEFAULT_PORT = 4173;

module.exports = (_env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: path.resolve(__dirname, 'src/index.tsx'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash].js' : '[name].js',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      // The IF libraries are isomorphic by design — pure logic anywhere, plus
      // optional Node-only convenience layers (fs-based OUI loading, https
      // registry refresh, fs-based JoinEUI map loading). We never call those
      // in the browser, but their source still references fs/path/os/https.
      // Setting these to `false` tells webpack to stub them out — keeps the
      // bundle lean and surfaces a clear error if anything ever does call
      // a Node-only path by mistake.
      //
      // `buffer`, `events`, `process`, `stream`, and `url` ARE used at runtime
      // (mqtt browser build expects them) so they get real polyfills below.
      fallback: {
        fs: false,
        path: false,
        os: false,
        https: false,
        http: false,
        net: false,
        tls: false,
        crypto: false,
        zlib: false,
        buffer: require.resolve('buffer/'),
        events: require.resolve('events/'),
        process: require.resolve('process/'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },     // type-check via `npm run typecheck`
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg|ico|woff2?|eot|ttf)$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'public/index.html'),
        favicon: undefined,
      }),
      // Provide Buffer as a global — mqtt's browser build and the IF
      // join-watcher's PHYPayload parser reach for it via the Node convention.
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      // Compile-time replace `process.env.X` reads in transitive deps (e.g.
      // oui-registry's optional cache-path env vars) with `undefined` so they
      // don't need a runtime process polyfill. Keep `process.env.NODE_ENV`
      // because mqtt and others actually check it.
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(argv.mode),
        'process.env.OUI_REGISTRY_CACHE': 'undefined',
        'process.env.XDG_CACHE_HOME': 'undefined',
        'process.browser': 'true',
      }),
    ],
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
    devServer: {
      port: parseInt(process.env.PORT, 10) || DEFAULT_PORT,
      host: process.env.HOST || 'localhost',
      historyApiFallback: true,            // SPA routing — unknown paths → index.html
      hot: true,
      open: true,
      client: {
        overlay: { errors: true, warnings: false },
      },
      static: {
        directory: path.resolve(__dirname, 'public'),
      },
    },
    performance: {
      // Two data bundles dominate the entrypoint and are intentional:
      //   - IEEE OUI registry      ~1.8 MB  (offline vendor identification)
      //   - TTN device catalog     ~3.8 MB  (curated subset of vendors)
      // Total payload ~7 MB raw / ~1.5 MB gzipped. Acceptable for a
      // local-network tool. Bump the budget so warnings don't drown out
      // anything genuinely problematic.
      hints: isProd ? 'warning' : false,
      maxAssetSize: 8 * 1024 * 1024,
      maxEntrypointSize: 8 * 1024 * 1024,
    },
  };
};
