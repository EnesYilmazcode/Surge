const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const context = {
    module: { exports: {} }, console,
    require(request) {
      if (request === './mna.js') return load('solver');
      if (request === './board-model.js') return load('board-model');
      throw new Error('Unexpected workbench dependency: ' + request);
    },
  };
  const file = path.join(__dirname, '../../public/editor', name + '.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  cache.set(name, context.module.exports);
  return context.module.exports;
}
module.exports = load;
