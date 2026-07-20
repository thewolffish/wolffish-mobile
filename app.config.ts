import type { ExpoConfig } from 'expo/config'

export const APP_NAME = 'Wolffish'
export const APP_SCHEME = 'wolffish'
const EXPO_PROJECT_ID = '684beeaa-cdb0-48d4-aab0-bf7c0aae92a0'
const EXPO_PROJECT_SLUG = 'wolffish-mobile'
const EXPO_PROJECT_OWNER = 'younes-alturkey'
const PACKAGE_IDENTIFIER = 'sh.wolffi.mobile'
// Bumped by scripts/provision.js — keep the exact format of these lines.
export const APP_VERSION = '1.0.2'
export const CODE_VERSION = 3
export const UPDATE_DATE = '2026-07-20T00:00:00.000Z'
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
    bundleIdentifier: PACKAGE_IDENTIFIER,
    buildNumber: CODE_VERSION.toString(),
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
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
