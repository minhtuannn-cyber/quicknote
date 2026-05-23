module.exports = {
  packagerConfig: {
    asar: true,
    icon: './src/assets/icon',
    name: 'QuickNote',
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
  ],
};
