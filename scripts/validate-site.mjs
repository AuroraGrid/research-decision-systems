import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const requiredFiles = [
  'index.html',
  'styles.css',
  'robots.txt',
  'sitemap.xml',
  'vercel.json',
  'eu-chat-control.html',
  'russian-jfk-dossier.html',
];

const fail = (message) => failures.push(message);
const read = (file) => readFileSync(resolve(root, file), 'utf8');

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) fail(`Missing required file: ${file}`);
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function resolveLocalTarget(htmlFile, rawTarget) {
  const target = rawTarget.split('#')[0].split('?')[0];
  if (!target || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target)) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }

  const candidate = decoded.startsWith('/')
    ? resolve(root, `.${decoded}`)
    : resolve(dirname(htmlFile), decoded);

  const attempts = [candidate];
  if (decoded.endsWith('/')) attempts.push(join(candidate, 'index.html'));
  if (!extname(candidate)) {
    attempts.push(`${candidate}.html`);
    attempts.push(join(candidate, 'index.html'));
  }

  return attempts.find(existsSync) ?? normalize(candidate);
}

const htmlFiles = walk(root).filter((file) => file.endsWith('.html'));
if (htmlFiles.length < 3) fail(`Expected at least 3 HTML pages; found ${htmlFiles.length}`);

for (const htmlFile of htmlFiles) {
  const html = readFileSync(htmlFile, 'utf8');
  const label = relative(root, htmlFile);

  if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(html)) fail(`${label}: missing html lang attribute`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${label}: missing non-empty title`);
  if (!/<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']+["']/i.test(html)) fail(`${label}: missing meta description`);
  if (!/<main\b/i.test(html)) fail(`${label}: missing main landmark`);
  if (!/<h1\b/i.test(html)) fail(`${label}: missing h1`);
  if (/DecompressionStream|document\.write\s*\(|\batob\s*\(/i.test(html)) fail(`${label}: contains prohibited browser bootstrap code`);

  for (const image of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=["'][^"']*["']/i.test(image[0])) fail(`${label}: image without alt attribute`);
  }

  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const rawTarget = match[1];
    const resolvedTarget = resolveLocalTarget(htmlFile, rawTarget);
    if (resolvedTarget && !existsSync(resolvedTarget)) {
      fail(`${label}: unresolved local reference ${rawTarget}`);
    }
  }
}

if (existsSync(resolve(root, 'index.html'))) {
  const homepage = read('index.html');
  for (const token of ['AURORA GRID', 'RECORD LOCK', 'Inspectable proof', 'Selected work']) {
    if (!homepage.includes(token)) fail(`index.html: missing required content token: ${token}`);
  }
  if (!/<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/hasan-research-systems\.vercel\.app\//i.test(homepage)) {
    fail('index.html: canonical production URL is missing or incorrect');
  }
}

if (existsSync(resolve(root, 'sitemap.xml'))) {
  const sitemap = read('sitemap.xml');
  for (const route of ['/', '/eu-chat-control', '/russian-jfk-dossier']) {
    const expected = `https://hasan-research-systems.vercel.app${route}`;
    if (!sitemap.includes(expected)) fail(`sitemap.xml: missing ${expected}`);
  }
}

if (existsSync(resolve(root, 'robots.txt'))) {
  const robots = read('robots.txt');
  if (!/User-agent:\s*\*/i.test(robots)) fail('robots.txt: missing wildcard user agent');
  if (!robots.includes('https://hasan-research-systems.vercel.app/sitemap.xml')) fail('robots.txt: missing production sitemap URL');
}

if (existsSync(resolve(root, 'vercel.json'))) {
  try {
    const config = JSON.parse(read('vercel.json'));
    const headers = (config.headers ?? []).flatMap((rule) => rule.headers ?? []);
    const keys = new Set(headers.map((header) => String(header.key).toLowerCase()));
    for (const key of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) {
      if (!keys.has(key)) fail(`vercel.json: missing security header ${key}`);
    }
  } catch (error) {
    fail(`vercel.json: invalid JSON (${error.message})`);
  }
}

if (failures.length) {
  console.error(`Site validation failed with ${failures.length} issue(s):`);
  for (const issue of failures) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Site validation passed: ${htmlFiles.length} HTML pages and all required local assets resolved.`);
