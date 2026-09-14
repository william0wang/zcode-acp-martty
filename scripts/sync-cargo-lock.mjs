#!/usr/bin/env node
// Keep Cargo.lock's workspace entry in step with Cargo.toml.
//
// release-please bumps Cargo.toml through its `x-release-please-version`
// marker, but its TOML updater cannot bump Cargo.lock: the JSONPath runs over
// position-tagged values, so the array filter that would select the package by
// name never compares equal and the lock silently lags the manifest. A lagging
// lock breaks every `cargo build --locked` (CI and local), so release PRs are
// synced with this script before they are merged.
import { readFileSync, writeFileSync } from 'node:fs'

function packageVersion(toml) {
  let inPackage = false
  for (const line of toml.split(/\r?\n/)) {
    const section = line.trim().match(/^\[([^\]]+)\]$/)
    if (section) {
      inPackage = section[1] === 'package'
      continue
    }
    if (!inPackage) continue
    const version = line.match(/^\s*version\s*=\s*["']([^"']+)["']/)
    if (version) return version[1]
  }
  throw new Error('Cargo package version not found in Cargo.toml')
}

const cargoToml = readFileSync('Cargo.toml', 'utf8')
const packageName = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(cargoToml)?.[1]
if (!packageName) throw new Error('Cargo package name not found in Cargo.toml')
const version = packageVersion(cargoToml)

const lock = readFileSync('Cargo.lock', 'utf8')
const entry = new RegExp(
  `(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")[^"]+(")`,
)
if (!entry.test(lock)) {
  throw new Error(`Cargo.lock has no [[package]] entry for ${packageName}`)
}

const synced = lock.replace(entry, `$1${version}$2`)
if (synced !== lock) writeFileSync('Cargo.lock', synced)
process.stdout.write(`${packageName} ${version}\n`)
