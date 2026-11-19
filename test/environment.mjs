// The ordinary suite is independent of downloaded native binaries. Native
// engine tests opt in explicitly; run npm run test:engines for real releases.
process.env.NATIVE_ENGINES = 'false';
