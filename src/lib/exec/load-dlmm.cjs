/* eslint-disable @typescript-eslint/no-require-imports */
// CommonJS build of the DLMM SDK. Its ESM file imports an Anchor directory,
// which Node rejects. require() resolves that directory to index.js.
module.exports = require("@meteora-ag/dlmm");
