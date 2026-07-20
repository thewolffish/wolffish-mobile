// Pins a store release AFTER the submission is verified: tags HEAD as
// v{APP_VERSION} (recording the shipped build number in the tag message)
// and pushes. Changes no files — provisioning new builds is
// scripts/provision.js. One release tag usually follows several
// provisioned builds; the tag marks the one that actually shipped.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const config = fs.readFileSync(path.join(root, 'app.config.ts'), 'utf8')

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim()

const codeMatch = config.match(/export const CODE_VERSION = (\d+)/)
const versionMatch = config.match(/export const APP_VERSION = '([^']+)'/)
if (!codeMatch || !versionMatch) {
  console.error('CODE_VERSION or APP_VERSION not found in app.config.ts')
  process.exit(1)
}
const version = versionMatch[1]
const code = codeMatch[1]
const tag = `v${version}`

if (out('git', ['status', '--porcelain'])) {
  console.error('Working tree is not clean — commit or stash first.')
  process.exit(1)
}

const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
if (pkgVersion !== version) {
  console.error(
    `package.json is ${pkgVersion} but app.config.ts is ${version} — run npm run provision.`
  )
  process.exit(1)
}

if (out('git', ['tag', '--list', tag])) {
  console.error(`${tag} already exists — start a new version with: npm run provision <x.y.z>`)
  process.exit(1)
}

run('git', ['tag', '-a', tag, '-m', `release: ${tag} (build ${code})`])

const hasOrigin = out('git', ['remote']).split('\n').includes('origin')
if (hasOrigin) {
  run('git', ['push', 'origin', 'HEAD', '--tags'])
} else {
  console.log('No "origin" remote — pushed nothing. Push manually to trigger the release workflow.')
}

console.log(`Released ${tag} (build ${code})`)
