import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENGINE_RELEASES } from './engine-releases.mjs';

if (process.env.NATIVE_ENGINES === 'false') { console.log('Native engines disabled.'); process.exit(0); }
const platform = `${process.platform}-${process.arch}`;
const destination = fileURLToPath(new URL('../.engines/', import.meta.url));
if (!Object.values(ENGINE_RELEASES).every(release => release.assets[platform])) throw new Error(`No bundled native engines for ${platform}; configure STOCKFISH_PATH / FAIRY_STOCKFISH_PATH or NATIVE_ENGINES=false.`);
await mkdir(destination, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'sanco-engines-'));
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
try {
  for (const [id, release] of Object.entries(ENGINE_RELEASES)) {
    const asset = release.assets[platform], directory = path.join(destination, id);
    const target = path.join(directory, `${id}${process.platform === 'win32' ? '.exe' : ''}`);
    const record = path.join(directory, 'release.json');
    if (existsSync(target) && existsSync(record)) {
      const installed = JSON.parse(await readFile(record, 'utf8'));
      const bytes = await readFile(target);
      if (installed.archiveSha256 === asset.sha256 && installed.binarySha256 === createHash('sha256').update(bytes).digest('hex')) { console.log(`${id} ${release.version} already installed.`); continue; }
    }
    console.log(`Installing ${id} ${release.version} (${platform})...`);
    const bytes = await download(`${release.base}${asset.name}`);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`SHA-256 mismatch for ${id}`);
    await mkdir(directory, { recursive: true });
    const pending = path.join(directory, `.install-${randomUUID()}`);
    if (release.archive) {
      const archive = path.join(temporary, asset.name), extracted = path.join(temporary, id);
      await writeFile(archive, bytes); await mkdir(extracted, { recursive: true });
      // Extract just the verified executable; no archive paths are written to the project.
      execFileSync('tar', ['-xf', archive, '-C', extracted, asset.binary], { windowsHide: true });
      await copyFile(path.join(extracted, asset.binary), pending);
    } else await writeFile(pending, bytes);
    await chmod(pending, 0o755);
    const license = await download(release.license);
    await writeFile(path.join(directory, 'COPYING.txt'), license);
    await writeFile(path.join(directory, 'SOURCE.txt'), `${id} ${release.version}\nGPL-3.0\nCorresponding source: ${release.source}\nBinary release: ${release.base}${asset.name}\n`);
    // Copying avoids replacing a running executable on platforms that reject it.
    await copyFile(pending, target); await chmod(target, 0o755); await rm(pending);
    const binarySha256 = createHash('sha256').update(await readFile(target)).digest('hex');
    await writeFile(record, JSON.stringify({ id, version: release.version, source: release.source, archiveSha256: asset.sha256, binarySha256 }, null, 2));
    console.log(`${id} installed and verified.`);
  }
} finally {
  const resolved = path.resolve(temporary), expected = path.resolve(tmpdir()) + path.sep;
  if (!resolved.startsWith(expected) || !path.basename(resolved).startsWith('sanco-engines-')) throw new Error('Refusing to remove an unexpected temporary path');
  await rm(resolved, { recursive: true, force: true });
}
