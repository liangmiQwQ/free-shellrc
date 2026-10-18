import { readFile } from 'node:fs/promises'

import { liangmi } from '@liangmi/vp-config'

const cleanupScriptId = '\0free-shellrc-cleanup-script'
const cleanupScriptUrl = new URL('src/cleanup.cjs', import.meta.url)

export default await liangmi({
  pack: {
    entry: './src/index.ts',
    platform: 'node',
    plugins: [
      {
        name: 'free-shellrc-cleanup-script',
        resolveId(source) {
          return source === './cleanup.cjs?raw' ? cleanupScriptId : undefined
        },
        async load(id) {
          if (id === cleanupScriptId) {
            const source = await readFile(cleanupScriptUrl, 'utf8')
            return `export default ${JSON.stringify(source)}`
          }
          return null
        }
      }
    ]
  }
})
