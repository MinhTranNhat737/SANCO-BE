import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--env')) {
  console.error('Usage: npm run oauth:check -- [--env path/to/.env]');
  process.exit(1);
}
const envFile = args.length ? resolve(args[1]) : fileURLToPath(new URL('../.env', import.meta.url));
const loaded = config({ path: envFile, quiet: true });
if (loaded.error && (args.length || loaded.error.code !== 'ENOENT')) {
  console.error('Không đọc được file cấu hình. Kiểm tra đường dẫn --env.');
  process.exit(1);
}

let errors = 0;
const fail = message => { console.error(`THIẾU/LỖI: ${message}`); errors++; };
const env = process.env;
const required = name => { if (!env[name]?.trim()) fail(name); };
for (const name of ['PUBLIC_API_URL', 'FRONTEND_ORIGIN', 'OAUTH_STATE_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']) required(name);
if (env.OAUTH_STATE_SECRET && env.OAUTH_STATE_SECRET.length < 32) fail('OAUTH_STATE_SECRET cần ít nhất 32 ký tự ngẫu nhiên.');

function checkUrl(value, label, originOnly = false) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !loopback) || (originOnly && url.pathname !== '/')) throw new Error();
    return url;
  } catch {
    fail(`${label} cần URL hợp lệ; dùng HTTPS ngoài localhost/127.0.0.1.`);
    return null;
  }
}
const origins = (env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
for (const origin of origins) checkUrl(origin, 'FRONTEND_ORIGIN', true);
const base = env.PUBLIC_API_URL ? checkUrl(env.PUBLIC_API_URL, 'PUBLIC_API_URL', true) : null;
for (const provider of ['google', 'facebook']) {
  const explicit = env[`${provider.toUpperCase()}_REDIRECT_URI`];
  const callback = explicit || (base ? `${base.origin}/api/auth/${provider}/callback` : '');
  if (callback && checkUrl(callback, `${provider} callback`)) console.log(`${provider}: ${callback}`);
}
const version = env.FACEBOOK_GRAPH_VERSION || 'v26.0';
if (!/^v\d+\.0$/.test(version)) fail('FACEBOOK_GRAPH_VERSION cần dạng v26.0.');
else console.log(`Facebook Graph API: ${version}`);
if (base?.protocol === 'http:') console.log('Local HTTP: xem OAUTH-SETUP.md để bật HTTPS khi thử Facebook.');
console.log(errors ? `Cần hoàn thiện ${errors} mục cấu hình. Xem be/OAUTH-SETUP.md.` : 'Cấu hình đủ cho cả hai nhà cung cấp. Cần thử đăng nhập thật để xác nhận khóa và cài đặt trên Google/Meta.');
process.exitCode = errors ? 1 : 0;
