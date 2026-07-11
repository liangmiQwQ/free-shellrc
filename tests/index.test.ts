import { execFileSync } from 'node:child_process'
import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { EOL, platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { installShellrc } from '../src/index.ts'

const temporaryDirectories: string[] = []
const originalEnvironment = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  ZDOTDIR: process.env.ZDOTDIR
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true })
  }
  restoreEnvironment()
})

it('installs a Bash block once without changing user content', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const userContent = 'export USER_VALUE="kept"'
  await writeFile(profile, userContent)

  await expect(installShellrc({ bash: "alias demo='demo shell'" }, 'demo')).resolves.toBeTruthy()
  const installed = await readFile(profile, 'utf8')
  const installedMetadata = await stat(profile)

  expect(installed.startsWith(`${userContent}${EOL}`)).toBeTruthy()
  expect(installed).toContain('# >>> _demo_START >>>')
  expect(installed).toContain("alias demo='demo shell'")
  await expect(installShellrc({ bash: "alias demo='demo shell'" }, 'demo')).resolves.toBeFalsy()
  await expect(stat(profile)).resolves.toMatchObject({ ino: installedMetadata.ino })
})

it('uses an existing CRLF line ending for the managed block', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  await writeFile(profile, 'export KEEP=1\r\n')

  await installShellrc({ bash: 'first line\nsecond line' }, 'demo')
  const installed = await readFile(profile, 'utf8')

  expect(installed).not.toMatch(/(?<!\r)\n/)
  expect(installed).toContain('first line\r\nsecond line')
})

it('updates the first block in place and removes duplicate blocks', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  await writeFile(profile, `export BEFORE=1${EOL}`)
  await installShellrc({ bash: 'old-command' }, 'demo')
  const installed = await readFile(profile, 'utf8')
  const blockStart = installed.indexOf('# >>> _demo_START >>>')
  const block = installed.slice(blockStart)
  await appendFile(profile, `export AFTER=1${EOL}${EOL}${block}`)

  await expect(installShellrc({ bash: 'new-command' }, 'demo')).resolves.toBeTruthy()
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

  await expect(installShellrc({ bash: 'demo init' }, 'demo')).rejects.toMatchObject({
    code: 'ERR_INVALID_MARKERS'
  })
  await expect(readFile(profile, 'utf8')).resolves.toBe(malformed)
})

it('rejects invalid product names and conflicting caller commands', async () => {
  await expect(installShellrc({ bash: 'demo init' }, 'not valid')).rejects.toMatchObject({
    code: 'ERR_INVALID_PRODUCT_NAME'
  })

  const home = await createHome()
  await expect(installShellrc({ bash: '# >>> _demo_START >>>' }, 'demo')).rejects.toMatchObject({
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

    await installShellrc({ bash: 'demo init' }, 'demo')
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

  await expect(installShellrc({ bash: 'demo init' }, 'demo')).rejects.toMatchObject({
    code: 'ERR_UNSUPPORTED_ENCODING'
  })
  await expect(readFile(profile)).resolves.toStrictEqual(invalid)
})

it('rejects UTF-32 LE without treating it as UTF-16 LE', async () => {
  const home = await createHome()
  const profile = join(home, '.bashrc')
  const unsupported = Buffer.from([255, 254, 0, 0, 97, 0, 0, 0])
  await writeFile(profile, unsupported)

  await expect(installShellrc({ bash: 'demo init' }, 'demo')).rejects.toMatchObject({
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

  await installShellrc({ bash: 'demo init' }, 'demo')

  expect((await lstat(profile)).isSymbolicLink()).toBeTruthy()
  expect((await stat(target)).mode & 0o777).toBe(0o640)
  await expect(readFile(target, 'utf8')).resolves.toContain('demo init')
})

it.skipIf(platform() === 'win32')(
  'runs the command while the product exists and self-removes after it disappears',
  async () => {
    const home = await createHome()
    const profile = join(home, '.bashrc')
    const output = join(home, 'loaded')
    const original = 'export KEEP=1'
    await writeFile(profile, original)

    await installShellrc({ bash: `printf loaded > ${quotePosix(output)}` }, 'bash')
    execFileSync('bash', ['--noprofile', '--norc', '-c', `source ${quotePosix(profile)}`])
    await expect(readFile(output, 'utf8')).resolves.toBe('loaded')

    await writeFile(profile, original)
    await installShellrc({ bash: `printf should-not-run > ${quotePosix(output)}` }, 'missing-demo')
    execFileSync('bash', ['--noprofile', '--norc', '-c', `source ${quotePosix(profile)}`])

    await expect(readFile(profile, 'utf8')).resolves.toBe(original)
    await expect(readFile(output, 'utf8')).resolves.toBe('loaded')
  }
)

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

  await installShellrc({ pwsh: 'demo init' }, 'demo')

  await expect(readFile(profile, 'utf8')).resolves.toContain('demo init')
})

it.skipIf(platform() === 'win32')('reports Windows PowerShell as unavailable', async () => {
  await expect(installShellrc({ powershell: 'demo init' }, 'demo')).rejects.toMatchObject({
    code: 'ERR_UNAVAILABLE_SHELL'
  })
})

async function createHome(): Promise<string> {
  const home = await createTemporaryDirectory()
  process.env.HOME = home
  delete process.env.ZDOTDIR
  delete process.env.XDG_CONFIG_HOME
  return home
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'free-shellrc-'))
  temporaryDirectories.push(directory)
  return directory
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
