#!/usr/bin/env node
/**
 * Pack the built demo dataset into the bundle published at cdn.wolffi.sh/demo.
 *
 * Demo mode downloads this bundle on first entry — nothing is pushed to a
 * device and nothing is bundled into the app. Input is demo-data/ (produced by
 * build-demo-data.mjs); output is a flat directory ready to upload as-is:
 *
 *   manifest.json            index: version, totals, shard list
 *   config-snapshot.json     the config surface, copied verbatim
 *   conversations-000.json   { conversations: ConversationFile[] }
 *   …
 *
 * The 168 conversation files are packed into ~1.5 MB shards rather than served
 * individually (168 round trips) or as one 18 MB blob (one 18 MB string and
 * one 18 MB JSON.parse on a phone). A shard is downloaded, parsed, imported
 * and released before the next one starts, so peak memory is one shard and the
 * progress bar has real granularity. Files are left uncompressed on purpose:
 * Cloudflare brotli/gzips application/json in transit, so 18.6 MB ships as
 * ~4 MB with no decompression code on the client.
 *
 *   node scripts/demo/build-demo-bundle.mjs [--out DIR]
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC_DIR = process.env.DEMO_DATA ?? path.join(process.cwd(), 'demo-data')
const OUT_DIR = argValue('--out') ?? path.join(os.homedir(), 'Desktop', 'wolffish-demo-bundle')

/** Target uncompressed bytes per shard. One huge conversation may exceed it. */
const SHARD_TARGET_BYTES = 1.5 * 1024 * 1024

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

function shardName(index) {
  return `conversations-${String(index).padStart(3, '0')}.json`
}

async function main() {
  const convDir = path.join(SRC_DIR, 'conversations')
  const names = (await fs.readdir(convDir)).filter((name) => name.endsWith('.json')).sort()
  if (names.length === 0) {
    throw new Error(`no conversations in ${convDir} — run: node scripts/demo/build-demo-data.mjs`)
  }

  // Parse once, keep the compact re-serialization: the shard's bytes are what
  // the client downloads, so the manifest must describe those, not the inputs.
  const conversations = []
  for (const name of names) {
    const raw = await fs.readFile(path.join(convDir, name), 'utf8')
    const conv = JSON.parse(raw)
    if (!conv?.id || !Array.isArray(conv.messages)) {
      throw new Error(`malformed conversation: ${name}`)
    }
    conversations.push({ conv, bytes: Buffer.byteLength(JSON.stringify(conv)) })
  }

  // Largest first, then greedy pack — keeps the 600 KB conversations from
  // landing together and skewing one shard to 3 MB.
  conversations.sort((a, b) => b.bytes - a.bytes)
  const groups = []
  for (const entry of conversations) {
    const target = groups.find((group) => group.bytes + entry.bytes <= SHARD_TARGET_BYTES)
    if (target) {
      target.items.push(entry.conv)
      target.bytes += entry.bytes
    } else {
      groups.push({ items: [entry.conv], bytes: entry.bytes })
    }
  }
  // Newest conversations first within a shard, so an interrupted import still
  // leaves the most recognisable conversations on screen.
  for (const group of groups) group.items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(OUT_DIR, { recursive: true })

  const hash = createHash('sha256')
  const shards = []
  for (const [index, group] of groups.entries()) {
    const file = shardName(index)
    const body = Buffer.from(JSON.stringify({ conversations: group.items }))
    hash.update(body)
    await fs.writeFile(path.join(OUT_DIR, file), body)
    shards.push({ file, bytes: body.length, conversations: group.items.length })
  }

  const configBody = await fs.readFile(path.join(SRC_DIR, 'config-snapshot.json'))
  hash.update(configBody)
  await fs.writeFile(path.join(OUT_DIR, 'config-snapshot.json'), configBody)

  const totalBytes = shards.reduce((sum, shard) => sum + shard.bytes, 0)
  const manifest = {
    // Content hash, not a timestamp: re-running the build on unchanged data
    // must not look like a new dataset to a device that already imported it.
    version: hash.digest('hex').slice(0, 12),
    builtAt: new Date().toISOString(),
    conversations: conversations.length,
    totalBytes,
    config: { file: 'config-snapshot.json', bytes: configBody.length },
    shards
  }
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`version:       ${manifest.version}`)
  console.log(`conversations: ${manifest.conversations} in ${shards.length} shards`)
  console.log(
    `size:          ${(totalBytes / 1e6).toFixed(1)} MB uncompressed ` +
      `(largest shard ${(Math.max(...shards.map((s) => s.bytes)) / 1e6).toFixed(2)} MB)`
  )
  console.log(`output:        ${OUT_DIR}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
