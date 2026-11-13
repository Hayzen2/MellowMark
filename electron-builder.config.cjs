// Keep appId unchanged for every future release: Windows NSIS uses it as the upgrade identity.
// Set MELLOWMARK_UPDATE_URL to an HTTPS directory that hosts latest.yml + installer assets.
const updateUrl = process.env.MELLOWMARK_UPDATE_URL;
if (updateUrl && !/^https:\/\//i.test(updateUrl)) {
  throw new Error('MELLOWMARK_UPDATE_URL must be an HTTPS URL');
}
module.exports = {
  appId: 'com.mellowmark.desktop',
  productName: 'MellowMark',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  extraMetadata: { main: 'electron/main.cjs' },
  extraResources: [
    { from: 'build/icon.png', to: 'icon.png' },
    ...(process.platform === 'win32'
      ? [
          {
            from: 'vendor/tectonic/win32-x64',
            to: 'tex',
            filter: ['tectonic.exe', 'manifest.json', 'THIRD_PARTY_NOTICES.txt'],
          },
        ]
      : []),
  ],
  asar: true,
  // No invented release endpoint: app-update.yml is generated only when configured.
  ...(updateUrl ? { publish: [{ provider: 'generic', url: updateUrl }] } : {}),
  win: { icon: 'build/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: false,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MellowMark',
    uninstallDisplayName: 'MellowMark',
    deleteAppDataOnUninstall: false,
  },
  mac: { icon: 'build/icon.icns', target: ['dmg'], category: 'public.app-category.productivity' },
  linux: { icon: 'build/icon.png', target: ['AppImage'], category: 'Utility' },
};
