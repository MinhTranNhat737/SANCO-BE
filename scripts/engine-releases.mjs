// Official, pinned releases. SHA-256 is checked before extraction or execution.
export const ENGINE_RELEASES = {
  stockfish: {
    version: '19', source: 'https://github.com/official-stockfish/Stockfish/tree/sf_19',
    license: 'https://raw.githubusercontent.com/official-stockfish/Stockfish/sf_19/Copying.txt',
    assets: {
      'win32-x64': { name: 'stockfish-windows-x86-64-universal.zip', sha256: '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7', binary: 'stockfish/stockfish-windows-x86-64-universal.exe' },
      'linux-x64': { name: 'stockfish-linux-x86-64-universal.tar.gz', sha256: '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f', binary: 'stockfish/stockfish-linux-x86-64-universal' },
    },
    base: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/', archive: true,
  },
  'fairy-stockfish': {
    version: '14.0.1 XQ', source: 'https://github.com/fairy-stockfish/Fairy-Stockfish/tree/fairy_sf_14_0_1_xq',
    license: 'https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish/fairy_sf_14_0_1_xq/Copying.txt',
    assets: {
      'win32-x64': { name: 'fairy-stockfish-largeboard_x86-64.exe', sha256: '38c173576c13407b610a03da8c31144bbdee9f49d9d789c4e7b681cc18d36221' },
      'linux-x64': { name: 'fairy-stockfish-largeboard_x86-64', sha256: '7584bbf366f4be1c88ed37ded80c496dd561ddf0c5b4f5a710702500aa49dc56' },
    },
    base: 'https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14_0_1_xq/', archive: false,
  },
};
