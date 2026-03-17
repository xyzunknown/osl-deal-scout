const path = require('path');
const { createHandler } = require('../server');

module.exports = createHandler(path.join(__dirname, '..'), {
  basePath: process.env.APP_BASE_PATH || ''
});
