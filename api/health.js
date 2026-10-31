'use strict';

function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, shadowRequired: false });
}

module.exports = handle;
module.exports.handle = handle;
