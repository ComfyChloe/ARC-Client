const path = require('path');
module.exports = {
  target: 'electron-main',
  entry: './main.js',
  output: {
    path: path.resolve(__dirname, 'dist-webpack'),
    filename: 'main.js'
  },
  externals: {
    'electron': 'commonjs2 electron',
    'osc': 'commonjs2 osc',
    'socket.io-client': 'commonjs2 socket.io-client'
  },
  node: {
    __dirname: false,
    __filename: false
  },
  optimization: {
    minimize: true
  },
  mode: 'production'
};