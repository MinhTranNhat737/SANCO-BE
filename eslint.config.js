export default [{
  files:['**/*.js','**/*.mjs'],ignores:['node_modules/**'],
  languageOptions:{ecmaVersion:'latest',sourceType:'module'},
  rules:{'no-async-promise-executor':'error','no-dupe-args':'error','no-dupe-else-if':'error','no-dupe-keys':'error','no-unreachable':'error','no-unsafe-finally':'error'},
},{files:['scripts/install-engines.mjs'],rules:{'no-unsafe-finally':'off'}}]; // Intentional fail-closed temporary-path guard before recursive cleanup.
