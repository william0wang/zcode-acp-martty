#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { nativeTargets } from './native-targets.mjs'

const legacyName = '@openma/deepseek-harness-tui'
const defaultNativePrefix = '@openma/martty'
const textExtensions = new Set(['.js', '.json', '.md', '.mjs', '.yaml', '.yml'])
// Never carried into the alias package: installed dependencies and the
// lockfile are build artifacts of the source checkout, not shippable
// content — rewriting (or packing) them would leak the alias rename into
// dependency internals.
const skippedEntries = new Set(['node_modules', 'package-lock.json'])

function rewriteTextFiles(root, aliasName, nativePrefix) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor' && !skippedEntries.has(entry.name)) {
        rewriteTextFiles(file, aliasName, nativePrefix)
      }
      continue
    }
    if (skippedEntries.has(entry.name)) continue
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue
    const before = readFileSync(file, 'utf8')
    let after = before.replaceAll(legacyName, aliasName)
    // A fork that renames the native packages must not ship docs still
    // pointing at @openma/martty-* — the default flow rewrites nothing.
    if (nativePrefix !== defaultNativePrefix) {
      after = after.replaceAll(`${defaultNativePrefix}-`, `${nativePrefix}-`)
    }
    if (after !== before) writeFileSync(file, after)
  }
}

try {
  const argv = process.argv.slice(2)
  const prefixFlag = argv.indexOf('--native-prefix')
  const nativePrefix = prefixFlag === -1
    ? defaultNativePrefix
    : argv.splice(prefixFlag, 2)[1]
  const [sourceArg, destinationArg, aliasName] = argv
  if (!sourceArg || !destinationArg || !aliasName || !nativePrefix) {
    throw new Error(
      'usage: package-alias.mjs <source> <destination> <alias-name> [--native-prefix <prefix>]',
    )
  }
  const source = path.resolve(sourceArg)
  const destination = path.resolve(destinationArg)
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`source package directory not found: ${source}`)
  }
  if (existsSync(destination)) {
    throw new Error(
      `destination already exists: ${destination}\n`
      + `  the alias is generated fresh per release — delete the stale copy first:\n`
      + `  rm -rf ${destination}`,
    )
  }
  const packageJson = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
  if (packageJson.name !== legacyName) {
    throw new Error(`expected source package ${legacyName}, found ${packageJson.name}`)
  }

  cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter(file) {
      const topLevel = path.relative(source, file).split(path.sep)[0]
      return !['vendor', 'node_modules', 'package-lock.json'].includes(topLevel)
    },
  })
  rewriteTextFiles(destination, aliasName, nativePrefix)
  // The alias is generated fresh for every release: if it were ever
  // published stale (an old checkout lingering on disk), the version and
  // dependency ranges would silently diverge from the source package.
  const aliasJson = JSON.parse(readFileSync(path.join(destination, 'package.json'), 'utf8'))
  if (aliasJson.version !== packageJson.version) {
    throw new Error(
      `alias version ${aliasJson.version} does not match source ${packageJson.version}`,
    )
  }
  aliasJson.optionalDependencies = Object.fromEntries(nativeTargets.map(({ platform, arch }) => [
    `${nativePrefix}-${platform}-${arch}`, aliasJson.version,
  ]))
  if (Array.isArray(aliasJson.files)) aliasJson.files = aliasJson.files.filter((entry) => entry !== 'vendor')
  writeFileSync(path.join(destination, 'package.json'), `${JSON.stringify(aliasJson, null, 2)}\n`)
  process.stdout.write(`${destination}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
