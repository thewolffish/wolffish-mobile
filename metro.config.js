const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// Markdown ships as a bundled asset, not as source: src/changelog/<month>/
// <locale>.md are release notes the Updates screen reads at runtime (see
// lib/changelog). Registering the extension here is what makes `import
// page from '@/changelog/2026-07/en.md'` resolve to an asset — served by
// Metro in development, packed into the binary for a store build — instead
// of Metro trying to parse the prose as JavaScript.
config.resolver.assetExts.push('md')

module.exports = withNativeWind(config, { input: './src/global.css' })
