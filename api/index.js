const { requestHandler } = require('../server');

module.exports = async function handler(req, res) {
  return requestHandler(req, res);
};
