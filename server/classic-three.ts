import type { Plugin } from 'vite'

// The prototype and workbench intentionally use different renderer generations.
// Legacy addons import "three" internally; keep those imports with their renderer.
export function classicThree(): Plugin {
  return {
    name: 'workbench-three-version',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source === 'three' && importer?.replaceAll('\\', '/').includes('/three-classic/')) {
        return this.resolve('three-classic', importer, { skipSelf: true })
      }
    },
  }
}
