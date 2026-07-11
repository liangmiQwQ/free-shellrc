// This script only removes its managed profile block after the owning package is uninstalled.
// Template literals keep the generated helper readable.
const crypto = require(`node:crypto`)
const fs = require(`node:fs`)
const path = require(`node:path`)

const [profile, startMarker, endMarker] = process.argv.slice(2)

if (cleanup()) {
  try {
    fs.unlinkSync(__filename)
    fs.rmdirSync(path.dirname(__filename))
  } catch {
    /* Self-removal failure must not affect profile cleanup. */
  }
}

function cleanup() {
  /* 1. Read and decode the profile without losing its original encoding. */
  const link = fs.lstatSync(profile).isSymbolicLink()
  const target = link ? fs.realpathSync(profile) : profile
  const original = fs.readFileSync(target)
  const stat = fs.statSync(target)

  let encoding = `utf8`
  let offset = 0
  if (original.subarray(0, 3).equals(Buffer.from([239, 187, 191]))) {
    encoding = `utf8-bom`
    offset = 3
  } else if (original.subarray(0, 2).equals(Buffer.from([255, 254]))) {
    encoding = `utf16le`
    offset = 2
  } else if (original.subarray(0, 2).equals(Buffer.from([254, 255]))) {
    encoding = `utf16be`
    offset = 2
  }

  const decoderEncoding =
    encoding === `utf8-bom`
      ? `utf8`
      : encoding === `utf16le`
        ? `utf-16le`
        : encoding === `utf16be`
          ? `utf-16be`
          : encoding
  const decoder = new TextDecoder(decoderEncoding, { fatal: true })
  const text = decoder.decode(original.subarray(offset))
  const lines = []
  const lineEnding = /\r\n|\n|\r/g
  let lineStart = 0
  let match

  /* 2. Locate only complete, exact managed blocks. */
  while ((match = lineEnding.exec(text))) {
    lines.push({
      content: text.slice(lineStart, match.index),
      contentEnd: match.index,
      end: match.index + match[0].length,
      start: lineStart
    })
    lineStart = match.index + match[0].length
  }
  if (lineStart < text.length) {
    lines.push({
      content: text.slice(lineStart),
      contentEnd: text.length,
      end: text.length,
      start: lineStart
    })
  }

  const blocks = []
  let opening
  for (const line of lines) {
    if (line.content === startMarker) {
      if (opening) {
        return false
      }
      opening = line
    } else if (line.content === endMarker) {
      if (!opening) {
        return false
      }
      blocks.push({ start: opening, end: line })
      opening = undefined
    }
  }
  if (opening || blocks.length === 0) {
    return false
  }

  /* 3. Remove managed blocks while preserving every other character. */
  let updated = text
  for (const block of blocks.toReversed()) {
    const previous = lines.find(line => line.end === block.start.start)
    const from = previous
      ? previous.content.length === 0
        ? previous.start
        : previous.contentEnd
      : block.start.start
    const to =
      block.end.end < text.length && previous && previous.content.length > 0
        ? block.end.contentEnd
        : block.end.end
    updated = updated.slice(0, from) + updated.slice(to)
  }

  /* 4. Restore the original byte encoding and byte-order mark. */
  let content = Buffer.from(updated, encoding.startsWith(`utf16`) ? `utf16le` : `utf8`)
  if (encoding === `utf16be`) {
    for (let index = 0; index < content.length; index += 2) {
      const first = content[index]
      content[index] = content[index + 1]
      content[index + 1] = first
    }
  }
  if (encoding === `utf8-bom`) {
    content = Buffer.concat([Buffer.from([239, 187, 191]), content])
  } else if (encoding === `utf16le`) {
    content = Buffer.concat([Buffer.from([255, 254]), content])
  } else if (encoding === `utf16be`) {
    content = Buffer.concat([Buffer.from([254, 255]), content])
  }

  /* 5. Replace the resolved target only if it has not changed. */
  if (!fs.readFileSync(target).equals(original)) {
    return false
  }
  const temporary = path.join(
    path.dirname(target),
    `.free-shellrc-${crypto.randomBytes(8).toString(`hex`)}`
  )
  try {
    fs.writeFileSync(temporary, content, { flag: `wx`, mode: stat.mode })
    fs.chmodSync(temporary, stat.mode)
    if (!fs.readFileSync(target).equals(original)) {
      throw new Error(`Concurrent profile change`)
    }
    fs.renameSync(temporary, target)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch {
      /* Cleanup failure must not hide the original result. */
    }
  }
  return true
}
