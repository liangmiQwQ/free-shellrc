import { createShellrcError } from './errors.ts'

export type ProfileEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be'

export interface DecodedProfile {
  encoding: ProfileEncoding
  text: string
}

const UTF8_BOM = Buffer.from([239, 187, 191])
const UTF16LE_BOM = Buffer.from([255, 254])
const UTF16BE_BOM = Buffer.from([254, 255])
const UTF32LE_BOM = Buffer.from([255, 254, 0, 0])

export function decodeProfile(bytes: Buffer): DecodedProfile {
  let encoding: ProfileEncoding = 'utf8'
  let content = bytes

  if (bytes.subarray(0, 4).equals(UTF32LE_BOM)) {
    throw unsupportedEncoding()
  } else if (bytes.subarray(0, 3).equals(UTF8_BOM)) {
    encoding = 'utf8-bom'
    content = bytes.subarray(3)
  } else if (bytes.subarray(0, 2).equals(UTF16LE_BOM)) {
    encoding = 'utf16le'
    content = bytes.subarray(2)
  } else if (bytes.subarray(0, 2).equals(UTF16BE_BOM)) {
    encoding = 'utf16be'
    content = bytes.subarray(2)
  }

  try {
    const decoderEncoding =
      encoding === 'utf8-bom'
        ? 'utf8'
        : encoding === 'utf16le'
          ? 'utf-16le'
          : encoding === 'utf16be'
            ? 'utf-16be'
            : encoding
    return {
      encoding,
      text: new TextDecoder(decoderEncoding, {
        fatal: true
      }).decode(content)
    }
  } catch (error) {
    throw unsupportedEncoding(error)
  }
}

function unsupportedEncoding(cause?: unknown) {
  return createShellrcError(
    'ERR_UNSUPPORTED_ENCODING',
    'The shell profile uses an unsupported or invalid encoding.',
    cause === undefined ? undefined : { cause }
  )
}

export function encodeProfile(text: string, encoding: ProfileEncoding): Buffer {
  if (encoding === 'utf8') {
    return Buffer.from(text, 'utf8')
  }
  if (encoding === 'utf8-bom') {
    return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')])
  }

  const content = Buffer.from(text, 'utf16le')
  if (encoding === 'utf16le') {
    return Buffer.concat([UTF16LE_BOM, content])
  }

  for (let index = 0; index < content.length; index += 2) {
    const first = content[index]
    content[index] = content[index + 1]
    content[index + 1] = first
  }
  return Buffer.concat([UTF16BE_BOM, content])
}
