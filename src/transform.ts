import { EOL } from 'node:os'

import { createShellrcError } from './errors.ts'

interface Line {
  content: string
  contentEnd: number
  end: number
  start: number
}

interface ManagedBlock {
  end: Line
  start: Line
}

export interface Markers {
  end: string
  start: string
}

export function createMarkers(productName: string): Markers {
  return {
    start: `# >>> _${productName}_START >>>`,
    end: `# <<< _${productName}_END <<<`
  }
}

export function detectLineEnding(text: string): string {
  return /\r\n|\n|\r/.exec(text)?.[0] ?? EOL
}

export function transformProfile(text: string, markers: Markers, managedBlock: string): string {
  const lines = splitLines(text)
  const blocks = findManagedBlocks(lines, markers)

  if (blocks.length === 0) {
    return text.length === 0 ? managedBlock : `${text}${detectLineEnding(text)}${managedBlock}`
  }

  const replacements = blocks.map((block, index) => ({
    end: index === 0 ? block.end.end : removableBlockEnd(block, lines, text.length),
    start: index === 0 ? block.start.start : removableBlockStart(block, lines),
    value: index === 0 ? managedBlock : ''
  }))

  let result = text
  for (const replacement of replacements.toReversed()) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  }
  return result
}

export function assertCommandDoesNotContainMarkers(command: string, markers: Markers): void {
  const conflicts = splitLines(command).some(
    line => line.content === markers.start || line.content === markers.end
  )
  if (conflicts) {
    throwInvalidMarkers()
  }
}

function splitLines(text: string): Line[] {
  const lines: Line[] = []
  const lineEnding = /\r\n|\n|\r/g
  let start = 0
  let match: RegExpExecArray | null

  while ((match = lineEnding.exec(text))) {
    lines.push({
      content: text.slice(start, match.index),
      contentEnd: match.index,
      end: match.index + match[0].length,
      start
    })
    start = match.index + match[0].length
  }
  if (start < text.length) {
    lines.push({ content: text.slice(start), contentEnd: text.length, end: text.length, start })
  }
  return lines
}

function findManagedBlocks(lines: Line[], markers: Markers): ManagedBlock[] {
  const blocks: ManagedBlock[] = []
  let opening: Line | undefined

  for (const line of lines) {
    if (line.content === markers.start) {
      if (opening) {
        throwInvalidMarkers()
      }
      opening = line
    } else if (line.content === markers.end) {
      if (!opening) {
        throwInvalidMarkers()
      }
      blocks.push({ start: opening, end: line })
      opening = undefined
    }
  }
  if (opening) {
    throwInvalidMarkers()
  }
  return blocks
}

function removableBlockStart(block: ManagedBlock, lines: Line[]): number {
  const previous = lines.find(line => line.end === block.start.start)
  if (!previous) {
    return block.start.start
  }
  return previous.content === '' ? previous.start : previous.contentEnd
}

function removableBlockEnd(block: ManagedBlock, lines: Line[], textLength: number): number {
  const hasContentAfterBlock = block.end.end < textLength
  const precedingLineHasContent = lines.find(line => line.end === block.start.start)?.content !== ''
  return hasContentAfterBlock && precedingLineHasContent ? block.end.contentEnd : block.end.end
}

function throwInvalidMarkers(): never {
  throw createShellrcError(
    'ERR_INVALID_MARKERS',
    'The shell profile contains incomplete, reversed, or nested managed markers.'
  )
}
