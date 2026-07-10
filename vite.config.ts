import { lib } from '@liangmi/vp-config'

export default lib({
  lint: {
    rules: {
      'no-console': 'off'
    }
  },
  pack: {
    entry: './src/index.ts'
  }
})
