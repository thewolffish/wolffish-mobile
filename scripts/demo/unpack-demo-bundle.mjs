#!/usr/bin/env node
/**
 * Unpack a published demo bundle into demo-data/ — the committed source of
 * truth for demo content.
 *
 * The inverse of build-demo-bundle.mjs. Reads a bundle directory (the shape
 * cdn.wolffi.sh/demo serves: manifest.json + config-snapshot.json +
 * conversations-NNN.json shards) and writes:
 *
 *   demo-data/conversations/<id>.json   one file per conversation, pretty-printed
 *   demo-data/config-snapshot.json      copied byte-for-byte
 *
 * Conversations are pretty-printed so they can be edited by hand — demo
 * content evolves by editing these files directly, never by deriving from a
 * live workspace. Formatting is free: the bundle build re-serializes each
 * conversation compactly, so an unpack → pack round trip reproduces the
 * bundle's version hash exactly. The config snapshot is hashed as raw bytes,
 * which is why it is copied verbatim rather than re-serialized.
 *
 *   node scripts/demo/unpack-demo-bundle.mjs [BUNDLE_DIR]   # default demo-data/bundle
 *
 * Rarely needed — demo-data/ lives in git and edits happen there — but kept
 * for re-deriving the editable files from a bundle. Reads nothing outside the
 * repo.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const BUNDLE_DIR = process.argv[2] ?? path.join(process.cwd(), 'demo-data', 'bundle')
const OUT_DIR = process.env.DEMO_OUT ?? path.join(process.cwd(), 'demo-data')

/** Conversation ids become filenames — refuse anything that couldn't be one. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(BUNDLE_DIR, 'manifest.json'), 'utf8'))
  if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) {
    throw new Error(`no shards listed in ${path.join(BUNDLE_DIR, 'manifest.json')}`)
  }

  const conversations = new Map()
  for (const shard of manifest.shards) {
    const body = JSON.parse(await fs.readFile(path.join(BUNDLE_DIR, shard.file), 'utf8'))
    if (!Array.isArray(body?.conversations)) throw new Error(`malformed shard: ${shard.file}`)
    for (const conv of body.conversations) {
      if (!conv?.id || !Array.isArray(conv.messages)) {
        throw new Error(`malformed conversation in ${shard.file}`)
      }
      if (!SAFE_ID.test(conv.id)) throw new Error(`unsafe conversation id: ${conv.id}`)
      if (conversations.has(conv.id)) throw new Error(`duplicate conversation id: ${conv.id}`)
      conversations.set(conv.id, conv)
    }
  }

  const convDir = path.join(OUT_DIR, 'conversations')
  await fs.rm(convDir, { recursive: true, force: true })
  await fs.mkdir(convDir, { recursive: true })
  for (const [id, conv] of conversations) {
    await fs.writeFile(path.join(convDir, `${id}.json`), `${JSON.stringify(conv, null, 2)}\n`)
  }

  await fs.copyFile(
    path.join(BUNDLE_DIR, 'config-snapshot.json'),
    path.join(OUT_DIR, 'config-snapshot.json')
  )

  console.log(`bundle:        ${BUNDLE_DIR} (version ${manifest.version})`)
  console.log(`conversations: ${conversations.size}`)
  console.log(`output:        ${OUT_DIR}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
