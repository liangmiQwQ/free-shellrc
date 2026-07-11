import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { EOL, platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { installShellrc, shellrcGuard } from '../src/index.ts'
import { createManagedBlock } from '../src/shells.ts'
import { createMarkers } from '../src/transform.ts'

const temporaryDirectories: string[] = []
const temporaryRestartPaths: string[] = []
const originalEnvironment = {
  HOME: process.env.HOME,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  PATH: process.env.PATH,
  SHELL: process.env.SHELL,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  ZDOTDIR: process.env.ZDOTDIR
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true })
  }
  for (const path of temporaryRestartPaths.splice(0)) {
    await rm(path, { force: true })
  }
  restoreEnvironment()
})

it('installs a Bash block once without changing user content', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const userContent = 'export USER_VALUE="kept"'
  await writeFile(profile, userContent)

  await expect(installShellrc(() => "alias demo='demo shell'", ['bash'])).resolves.toBeTruthy()
  const installed = await readFile(profile, 'utf8')
  const installedMetadata = await stat(profile)

  expect(installed.startsWith(`${userContent}${EOL}`)).toBeTruthy()
  expect(installed).toContain(
    `# >>> _demo_START >>>${EOL}# Please do not edit the comments \`# >>> _demo_START >>>\`, \`# <<< _demo_END <<<\` and the script between them, which probably makes demo's feature broken.`
  )
  expect(installed).toContain("alias demo='demo shell'")
  await expect(installShellrc(() => "alias demo='demo shell'", ['bash'])).resolves.toBeFalsy()
  await expect(stat(profile)).resolves.toMatchObject({ ino: installedMetadata.ino })
})

it.each(['bash', 'zsh', 'fish', 'powershell', 'pwsh'] as const)(
  'calls an external cleanup script for %s',
  shell => {
    const markers = createMarkers('demo')
    const block = createManagedBlock(
      shell,
      'demo init',
      "/tmp/demo's/entry.mjs",
      "/tmp/demo's/package.json",
      "/tmp/demo's/profile",
      '/tmp/demo.restart',
      "/tmp/demo's/cleanup.cjs",
      markers,
      '\n'
    )

    expect(block).not.toContain('function cleanup()')
    expect(Buffer.byteLength(block)).toBeLessThan(1024)

    const powerShell = shell === 'powershell' || shell === 'pwsh'
    const quotedProfile = powerShell ? "'/tmp/demo''s/profile'" : `'/tmp/demo'"'"'s/profile'`
    const quotedCleanup = powerShell
      ? "'/tmp/demo''s/cleanup.cjs'"
      : `'/tmp/demo'"'"'s/cleanup.cjs'`
    const cleanupCommand = powerShell ? '    & node' : '  command node'
    const failureGuard = powerShell
      ? ' *> $null'
      : shell === 'fish'
        ? ' >/dev/null 2>&1; or true'
        : ' >/dev/null 2>&1 || true'

    expect(block).toContain(
      `${cleanupCommand} ${quotedCleanup} ${quotedProfile} '${markers.start}' '${markers.end}'${failureGuard}`
    )
  }
)

it.skipIf(platform() === 'win32')(
  'requires one shell restart after the first installation',
  async () => {
    const home = await createHome()
    const profile = join(home, '.bashrc')

    prepareGuard(home, 'bash')
    await installShellrc(() => 'true', ['bash'])

    expect(() => {
      prepareGuard(home, 'bash')
    }).toThrow(expect.objectContaining({ code: 'ERR_SHELL_RESTART_REQUIRED' }))
    execFileSync('bash', ['--noprofile', '--norc', '-c', `source ${quotePosix(profile)}`])
    expect(() => {
      prepareGuard(home, 'bash')
    }).not.toThrow()
  }
)

it.skipIf(platform() === 'win32')('rejects an unsupported current shell', async () => {
  const home = await createHome()
  process.env.SHELL = '/bin/nu'

  expect(() => {
    prepareGuard(home)
  }).toThrow(expect.objectContaining({ code: 'ERR_UNSUPPORTED_SHELL' }))
})

it('installs only the current shell when no shell list is provided', async () => {
  const home = await createHome()

  await installShellrc(shellType => `command-for-${shellType}`)

  await expect(readFile(join(home, '.bashrc'), 'utf8')).resolves.toContain('command-for-bash')
  await expect(readFile(join(home, '.zshrc'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('uses an existing CRLF line ending for the managed block', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  await writeFile(profile, 'export KEEP=1\r\n')

  await installShellrc(() => 'first line\nsecond line', ['bash'])
  const installed = await readFile(profile, 'utf8')

  expect(installed).not.toMatch(/(?<!\r)\n/)
  expect(installed).toContain('first line\r\nsecond line')
})

it('updates the first block in place and removes duplicate blocks', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  await writeFile(profile, `export BEFORE=1${EOL}`)
  await installShellrc(() => 'old-command', ['bash'])
  const installed = await readFile(profile, 'utf8')
  const blockStart = installed.indexOf('# >>> _demo_START >>>')
  const block = installed.slice(blockStart)
  await appendFile(profile, `export AFTER=1${EOL}${EOL}${block}`)

  await expect(installShellrc(() => 'new-command', ['bash'])).resolves.toBeTruthy()
  const updated = await readFile(profile, 'utf8')

  expect(updated).not.toContain('old-command')
  expect(updated.split(/\r\n|\n|\r/).filter(line => line === '# >>> _demo_START >>>')).toHaveLength(
    1
  )
  expect(updated.indexOf('new-command')).toBeLessThan(updated.indexOf('export AFTER=1'))
  expect(updated.startsWith(`export BEFORE=1${EOL}`)).toBeTruthy()
})

it('does not write a profile containing malformed markers', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const malformed = `export KEEP=1${EOL}# >>> _demo_START >>>${EOL}`
  await writeFile(profile, malformed)

  await expect(installShellrc(() => 'demo init', ['bash'])).rejects.toMatchObject({
    code: 'ERR_INVALID_MARKERS'
  })
  await expect(readFile(profile, 'utf8')).resolves.toBe(malformed)
})

it('rejects conflicting caller commands', async () => {
  const home = await createHome()
  await expect(installShellrc(() => '# >>> _demo_START >>>', ['bash'])).rejects.toMatchObject({
    code: 'ERR_INVALID_MARKERS'
  })
  await expect(readFile(join(home, '.bashrc'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['utf8-bom', 'utf16le', 'utf16be'] as const)(
  'preserves %s encoding while installing',
  async encoding => {
    const home = await createHome()
    const profile = join(home, '.bashrc')
    const original = encodeForTest(`export KEEP=é${EOL}`, encoding)
    await writeFile(profile, original)

    await installShellrc(() => 'demo init', ['bash'])
    const installed = await readFile(profile)

    expect(bomFor(encoding).every((byte, index) => installed[index] === byte)).toBeTruthy()
    expect(decodeForTest(installed, encoding)).toContain(`export KEEP=é${EOL}`)
    expect(decodeForTest(installed, encoding)).toContain('demo init')
  }
)

it('rejects invalid unmarked UTF-8 without writing', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const invalid = Buffer.from([255, 97])
  await writeFile(profile, invalid)

  await expect(installShellrc(() => 'demo init', ['bash'])).rejects.toMatchObject({
    code: 'ERR_UNSUPPORTED_ENCODING'
  })
  await expect(readFile(profile)).resolves.toStrictEqual(invalid)
})

it('rejects UTF-32 LE without treating it as UTF-16 LE', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const unsupported = Buffer.from([255, 254, 0, 0, 97, 0, 0, 0])
  await writeFile(profile, unsupported)

  await expect(installShellrc(() => 'demo init', ['bash'])).rejects.toMatchObject({
    code: 'ERR_UNSUPPORTED_ENCODING'
  })
  await expect(readFile(profile)).resolves.toStrictEqual(unsupported)
})

it.skipIf(platform() === 'win32')('keeps a profile symlink and target permissions', async () => {
  const home = await createHome()
  const targetDirectory = await createTemporaryDirectory()
  const target = join(targetDirectory, 'profile')
  const profile = join(home, '.bashrc')
  await writeFile(target, `export KEEP=1${EOL}`)
  await chmod(target, 0o640)
  await symlink(target, profile)

  await installShellrc(() => 'demo init', ['bash'])

  expect((await lstat(profile)).isSymbolicLink()).toBeTruthy()
  expect((await stat(target)).mode & 0o777).toBe(0o640)
  await expect(readFile(target, 'utf8')).resolves.toContain('demo init')
})

it.skipIf(platform() === 'win32').each(['entry', 'package'] as const)(
  'runs while installed and self-removes when the %s file disappears',
  async missingFile => {
    const home = await createHome()
    const profile = join(home, '.bashrc')
    const output = join(home, 'loaded')
    const original = 'export KEEP=1'
    await writeFile(profile, original)

    prepareGuard(home)
    await installShellrc(() => `printf loaded > ${quotePosix(output)}`, ['bash'])
    const stateRoot = stateRootForTest(home)
    const [cleanupDirectoryName] = await readdir(stateRoot)
    const cleanupDirectory = join(stateRoot, cleanupDirectoryName)
    execFileSync('bash', ['--noprofile', '--norc', '-c', `source ${quotePosix(profile)}`])
    await expect(readFile(output, 'utf8')).resolves.toBe('loaded')

    await rm(output)
    const missingPath = join(
      home,
      'package',
      missingFile === 'entry' ? 'entry.mjs' : 'package.json'
    )
    await rm(missingPath)
    execFileSync('bash', ['--noprofile', '--norc', '-c', `source ${quotePosix(profile)}`])

    await expect(readFile(profile, 'utf8')).resolves.toBe(original)
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(cleanupDirectory)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  }
)

it('restores a missing cleanup helper without changing the profile', async () => {
  const home = await createHome()

  await installShellrc(() => 'demo init', ['bash'])
  const [cleanupDirectoryName] = await readdir(stateRootForTest(home))
  expect(cleanupDirectoryName).not.toMatch(/demo|free-shellrc/)
  const cleanupDirectory = join(stateRootForTest(home), cleanupDirectoryName)
  const [cleanupFile] = await readdir(cleanupDirectory)
  const cleanupPath = join(cleanupDirectory, cleanupFile)
  await rm(cleanupPath)

  await expect(installShellrc(() => 'demo init', ['bash'])).resolves.toBeFalsy()
  await expect(readFile(cleanupPath, 'utf8')).resolves.toContain('function cleanup()')
})

it.skipIf(platform() === 'win32')('queries pwsh for its profile path', async () => {
  const home = await createHome()
  const bin = join(home, 'bin')
  const profile = join(home, 'custom', 'profile.ps1')
  await mkdir(bin)
  const executable = join(bin, 'pwsh')
  await writeFile(executable, `#!/bin/sh${EOL}printf '%s\\n' "$FREE_SHELLRC_PROFILE"${EOL}`)
  await chmod(executable, 0o755)
  process.env.PATH = `${bin}:${process.env.PATH}`
  process.env.FREE_SHELLRC_PROFILE = profile

  await installShellrc(() => 'demo init', ['pwsh'])

  await expect(readFile(profile, 'utf8')).resolves.toContain('demo init')
})

it.skipIf(platform() === 'win32')('reports Windows PowerShell as unavailable', async () => {
  await expect(installShellrc(() => 'demo init', ['powershell'])).rejects.toMatchObject({
    code: 'ERR_UNAVAILABLE_SHELL'
  })
})

async function createHome(): Promise<string> {
  const home = await createTemporaryDirectory()
  process.env.HOME = home
  process.env.LOCALAPPDATA = join(home, 'state')
  process.env.SHELL = '/bin/bash'
  process.env.XDG_STATE_HOME = join(home, 'state')
  delete process.env.ZDOTDIR
  delete process.env.XDG_CONFIG_HOME
  prepareGuard(home)
  return home
}

function prepareGuard(home: string, packageName = 'demo'): void {
  const packageDirectory = join(home, 'package')
  const entryPath = join(packageDirectory, 'entry.mjs')
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name: packageName }))
  writeFileSync(entryPath, '')
  const identity = createHash('sha256').update(packageName).digest('hex').slice(0, 24)
  const restartPath = join(tmpdir(), `.free-shellrc-${identity}.restart`)
  if (!temporaryRestartPaths.includes(restartPath)) {
    temporaryRestartPaths.push(restartPath)
  }
  shellrcGuard(entryPath)
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'free-shellrc-'))
  temporaryDirectories.push(directory)
  return directory
}

function stateRootForTest(home: string): string {
  return platform() === 'darwin'
    ? join(home, 'Library', 'Application Support')
    : join(home, 'state')
}

function restoreEnvironment(): void {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
  delete process.env.FREE_SHELLRC_PROFILE
}

function encodeForTest(text: string, encoding: 'utf8-bom' | 'utf16le' | 'utf16be'): Buffer {
  if (encoding === 'utf8-bom') {
    return Buffer.concat([Buffer.from(bomFor(encoding)), Buffer.from(text)])
  }
  const content = Buffer.from(text, 'utf16le')
  if (encoding === 'utf16be') {
    content.swap16()
  }
  return Buffer.concat([Buffer.from(bomFor(encoding)), content])
}

function decodeForTest(bytes: Buffer, encoding: 'utf8-bom' | 'utf16le' | 'utf16be'): string {
  const content = bytes.subarray(bomFor(encoding).length)
  if (encoding === 'utf8-bom') {
    return content.toString('utf8')
  }
  const decoded = Buffer.from(content)
  if (encoding === 'utf16be') {
    decoded.swap16()
  }
  return decoded.toString('utf16le')
}

function bomFor(encoding: 'utf8-bom' | 'utf16le' | 'utf16be'): number[] {
  if (encoding === 'utf8-bom') {
    return [239, 187, 191]
  }
  return encoding === 'utf16le' ? [255, 254] : [254, 255]
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
