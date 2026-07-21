import type { ExpoConfig } from 'expo/config'

export const APP_NAME = 'Wolffish'
export const APP_SCHEME = 'wolffish'
const EXPO_PROJECT_ID = '684beeaa-cdb0-48d4-aab0-bf7c0aae92a0'
const EXPO_PROJECT_SLUG = 'wolffish-mobile'
const EXPO_PROJECT_OWNER = 'younes-alturkey'
const PACKAGE_IDENTIFIER = 'sh.wolffi.mobile'
// Deferred: capture of https://wolffi.sh links as native deep links. Off on
// purpose — the site is an install landing page, so web links must open the
// browser, not the app. To re-enable, uncomment this constant plus the
// associatedDomains / intentFilters blocks below, and restore the
// /.well-known files in wolffish-landing (recipe in its next.config.ts).
// Native change → new fingerprint runtime → ships only in a store binary.
// Known blockers: apex wolffi.sh 307s to www at the Vercel domain level
// (Apple/Google refuse redirected association files — set the domain to
// No Redirect first), and assetlinks.json needs signing-cert SHA-256s that
// exist only after the first Play upload (Play Console → App signing).
// const DEEP_LINK_HOSTS = ['wolffi.sh', 'www.wolffi.sh']
// Bumped by scripts/provision.js — keep the exact format of these lines.
export const APP_VERSION = '1.0.5'
export const CODE_VERSION = 4
export const UPDATE_DATE = '2026-07-21T00:00:00.000Z'
// Keep in sync with --color-ocean in src/global.css.
const BRAND_OCEAN = '#1b365d'
// Sampled from the top edge of assets/images/splash.png so the storyboard
// background is indistinguishable from the artwork.
const SPLASH_BACKGROUND = '#0d1b2d'

const config: ExpoConfig = {
  name: APP_NAME,
  slug: EXPO_PROJECT_SLUG,
  owner: EXPO_PROJECT_OWNER,
  scheme: APP_SCHEME,
  version: APP_VERSION,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    // Deferred universal links (Team ID A32F47KP86) — uncomment together
    // with DEEP_LINK_HOSTS above:
    // associatedDomains: DEEP_LINK_HOSTS.map((host) => `applinks:${host}`),
    bundleIdentifier: PACKAGE_IDENTIFIER,
    buildNumber: CODE_VERSION.toString(),
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    // Deferred app links — uncomment together with DEEP_LINK_HOSTS above
    // (autoVerify fails until assetlinks.json carries real fingerprints):
    // intentFilters: [
    //   {
    //     action: 'VIEW',
    //     autoVerify: true,
    //     data: DEEP_LINK_HOSTS.map((host) => ({ scheme: 'https', host })),
    //     category: ['BROWSABLE', 'DEFAULT']
    //   }
    // ],
    package: PACKAGE_IDENTIFIER,
    versionCode: CODE_VERSION,
    adaptiveIcon: {
      foregroundImage: './assets/images/icon-trans.png',
      backgroundColor: BRAND_OCEAN
    },
    predictiveBackGestureEnabled: false
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png'
  },
  extra: {
    eas: {
      projectId: EXPO_PROJECT_ID
    }
  },
  // OTA updates (EAS Update). Store builds poll this URL at every cold start
  // and never block launch (fallbackToCacheTimeout 0): a downloaded update
  // applies on the next cold start, and useOtaUpdates adds foreground checks
  // plus a restart toast. Publishing is scripts/ota.js. The fingerprint
  // runtime version gates which binaries an update can reach — see
  // fingerprint.config.js for what is deliberately excluded from the hash
  // (version bumps must not fork the runtime).
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    url: `https://u.expo.dev/${EXPO_PROJECT_ID}`,
    fallbackToCacheTimeout: 0
  },
  plugins: [
    'expo-router',
    'expo-localization',
    [
      // SDK 57 dropped the top-level `splash` key growth-app uses; this
      // plugin config with the legacy full-screen mode reproduces the same
      // result: splash.png scaled to fit on the brand background.
      'expo-splash-screen',
      {
        backgroundColor: SPLASH_BACKGROUND,
        image: './assets/images/splash.png',
        // cover: the full-bleed artwork fills every screen aspect with no
        // letterbox bars, so the background color never actually shows.
        resizeMode: 'cover',
        enableFullScreenImage_legacy: true
      }
    ],
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/IBMPlexSansArabic-Regular.ttf',
          './assets/fonts/IBMPlexSansArabic-Medium.ttf',
          './assets/fonts/IBMPlexSansArabic-SemiBold.ttf',
          './assets/fonts/IBMPlexSansArabic-Bold.ttf'
        ]
      }
    ]
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true
  }
}

export default config
