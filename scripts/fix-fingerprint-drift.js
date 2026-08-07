// Undoes a node_modules edit that silently forks the runtime fingerprint.
//
// @react-native-masked-view/masked-view rewrites its OWN AndroidManifest.xml
// from android/build.gradle, at Gradle *configuration* time: on AGP >= 7 it
// strips `package="org.reactnative.maskedview"` in favour of a namespace and
// writes the file back into node_modules. So any local Android build — npm run
// android, or anything that configures Gradle — permanently edits an installed
// dependency. (The library means to tidy the leftover double space afterwards,
// but discards the result: `manifestContent.replaceAll("  ", " ")` on an
// immutable string. The stripped file is what stays on disk.)
//
// That file is a fingerprint input: @expo/fingerprint hashes the package
// directory whole as an autolinked native source, for BOTH platforms
// (rncoreAutolinkingAndroid and rncoreAutolinkingIos — iOS is affected too,
// even though only Gradle causes it). EAS installs dependencies fresh and
// fingerprints before Gradle ever runs, so it always sees the pristine file.
// The two sides then disagree and every deploy path breaks:
//   - eas build fails outright: "Runtime version calculated on local machine
//     not equal to runtime version calculated during build"
//   - DEPLOY.md's gate A reports a false mismatch, and the procedure says to
//     obey it without argument — routing a JS-only change to a needless store
//     release, every time, for as long as the edit sits there
//
// Putting the attribute back is the whole fix. It is inert on AGP >= 7 (Gradle
// re-strips it on the next build; this script puts it back before the next
// fingerprint), and it makes the local hash identical to the one EAS computes.
// Idempotent: a no-op when the manifest is already pristine, and silent when
// the package isn't installed.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const pkgDir = path.join(root, 'node_modules', '@react-native-masked-view', 'masked-view')
const manifestPath = path.join(pkgDir, 'android', 'src', 'main', 'AndroidManifest.xml')
const gradlePath = path.join(pkgDir, 'android', 'build.gradle')

// Read the attribute back from the library's own build.gradle, which declares
// it as `def PACKAGE_PROP = "package=\"org.reactnative.maskedview\""`, so a
// version bump that renames the package keeps working. Falls back to the value
// shipped by 0.3.2 if that line ever moves.
const FALLBACK = 'package="org.reactnative.maskedview"'

function packageProp() {
  try {
    const gradle = fs.readFileSync(gradlePath, 'utf8')
    const match = gradle.match(/PACKAGE_PROP\s*=\s*"(package=\\"[^"\\]+\\")"/)
    return match ? match[1].replace(/\\"/g, '"') : FALLBACK
  } catch {
    return FALLBACK
  }
}

if (!fs.existsSync(manifestPath)) process.exit(0)

const before = fs.readFileSync(manifestPath, 'utf8')
const prop = packageProp()

// Already pristine — the common case, and the one that must stay quiet.
if (before.includes(prop)) process.exit(0)

// Gradle's `replaceAll(PACKAGE_PROP, '')` turns `<manifest package="…" xmlns…`
// into `<manifest  xmlns…`. Re-inserting at that same spot, collapsing the gap
// it left, restores the file byte for byte.
const after = before.replace(/<manifest\s+/, `<manifest ${prop} `)
if (after === before) {
  console.warn(`Could not restore ${prop} — no <manifest> tag in ${manifestPath}`)
  process.exit(0)
}

fs.writeFileSync(manifestPath, after)
console.log('Restored masked-view AndroidManifest.xml (stripped by a local Android build).')
