import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Opt in on the existing backend host; ordinary API-only deployments stay small.
if (process.env.BUILD_FRONTEND !== 'true') {
  console.log('Frontend build disabled (set BUILD_FRONTEND=true to enable).');
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = JSON.parse(await readFile(new URL('../frontend-source.json', import.meta.url),'utf8'));
  if (!/^MinhTranNhat737\/SANCO-FE$/.test(source.repository) || !/^[a-f0-9]{40}$/.test(source.commit)) throw new Error('Invalid pinned frontend source.');
  const temporary = await mkdtemp(path.join(os.tmpdir(),'sanco-frontend-build-'));
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved)!==path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('sanco-frontend-build-')) throw new Error('Unexpected frontend temporary directory.');
  try {
    console.log(`Building ${source.repository} at ${source.commit}`);
    const response = await fetch(`https://codeload.github.com/${source.repository}/tar.gz/${source.commit}`,{signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Frontend source download failed: HTTP ${response.status}`);
    const archive = path.join(temporary,'source.tar.gz'), checkout = path.join(temporary,'source');
    let bytes = 0;
    await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>150*1024*1024?new Error('Frontend archive exceeds size limit.'):null,chunk);}}),createWriteStream(archive));
    await mkdir(checkout);
    const run = (command,args,env=process.env) => {
      const result = spawnSync(command,args,{cwd:checkout,env,stdio:'inherit'});
      if (result.error) throw result.error;
      if (result.status!==0) throw new Error(`${command} ${args[0]} failed with exit ${result.status}`);
    };
    run('tar',['-xzf',archive,'--strip-components=1','-C',checkout]);
    const env = {...process.env,VERCEL_ENV:'',VITE_API_URL:'',SITE_URL:process.env.FRONTEND_SITE_URL||'',DEV_HTTPS_KEY:'',DEV_HTTPS_CERT:''};
    const npm = args => process.platform==='win32'
      ? run(process.execPath,[process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),...args],env)
      : run('npm',args,env);
    npm(['ci','--include=dev','--no-audit','--no-fund']);
    npm(['run','build']);
    const output = path.resolve(root,'public-frontend');
    await cp(path.join(checkout,'dist'),output,{recursive:true});
    await readFile(path.join(output,'admin.html'));
    console.log('Frontend built and staged in public-frontend/.');
  } finally {
    // Only remove the exact temporary directory created above, using one API.
    await rm(resolved,{recursive:true,force:true});
  }
}
