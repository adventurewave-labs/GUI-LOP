// Minimal js-cookie stub so frontend service modules load under the root
// (backend) Jest without installing the full react-scripts toolchain.
const api = { get: () => undefined, set: () => {}, remove: () => {} };
module.exports = api;
module.exports.default = api;
