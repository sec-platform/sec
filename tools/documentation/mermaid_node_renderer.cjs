/* Internal bridge for build_html.py's isolated worker. No downloads or package lookup. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
let browser, driver, page, blocked = [];
const lines = readline.createInterface({ input: process.stdin });
async function execute(x) {
  if (x.action === 'open') {
    driver = require(x.module);
    if (fs.statSync(x.engine).size > 30000000) throw new Error('Mermaid script exceeds renderer budget');
    const data = fs.readFileSync(x.engine);
    if (data.length > 30000000) throw new Error('Mermaid script exceeds renderer budget');
    browser = await driver.chromium.launch({ headless: true, chromiumSandbox: x.sandbox,
      ...(x.browser ? { executablePath: x.browser } : {}) });
    const context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, serviceWorkers: 'block' });
    await context.route('**/*', route => { blocked.push(route.request().url()); return route.abort(); });
    page = await context.newPage();
    page.setDefaultTimeout(x.timeout);
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    await page.addScriptTag({ content: data.toString('utf8') });
    if (!await page.evaluate(() => !!window.mermaid && typeof mermaid.render === 'function' && typeof mermaid.initialize === 'function'))
      throw new Error('Supply standalone Mermaid UMD/IIFE exposing window.mermaid');
    return { info: { engine_sha256: crypto.createHash('sha256').update(data).digest('hex'),
      browser: browser.version(), playwright: require(require('node:path').join(x.module, 'package.json')).version,
      font_family: x.font_family, browser_sandbox: x.sandbox, engine_label: x.engine_label,
      backend: 'node-playwright', node: process.version, architecture: process.arch } };
  }
  if (x.action === 'render') {
    if (/^\s*(?:%%\{\s*(?:init|config)|click\b|---\s*$)/m.test(x.source))
      throw new Error('Diagram-local configuration/callback rejected');
    const rendered = await page.evaluate(async x => {
      mermaid.initialize(x.config);
      let timer;
      try {
        const result = await Promise.race([mermaid.render(x.id, x.source),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('diagram timeout')), x.ms); })]);
        const parsed = new DOMParser().parseFromString(result.svg, 'text/html');
        const svg = parsed.querySelector('svg');
        if (!svg) throw new Error('missing SVG');
        return { svg: new XMLSerializer().serializeToString(svg) };
      } catch (error) {
        return { error: String(error.stack || error), kind: error.hash && Array.isArray(error.hash.expected) ? 'syntax' : 'fatal' };
      } finally { clearTimeout(timer); }
    }, x);
    if (blocked.length) throw new Error('Renderer attempted network access: ' + blocked.slice(0, 3).join(', '));
    return rendered;
  }
  if (x.action === 'close') { if (browser) await browser.close(); return { closed: true }; }
  throw new Error('Unknown renderer command');
}
(async () => {
  try {
    for await (const line of lines) {
      try { const request = JSON.parse(line); console.log(JSON.stringify(await execute(request))); if (request.action === 'close') break; }
      catch (error) { console.log(JSON.stringify({ error: error.stack || String(error), kind: 'fatal' })); }
    }
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
