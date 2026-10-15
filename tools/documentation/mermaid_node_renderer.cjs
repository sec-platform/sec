/* Internal bridge for build_html.py's isolated worker. No downloads or package lookup. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
let browser, driver, page, blocked = [];
const lines = readline.createInterface({ input: process.stdin });
async function execute(x) {
  if (x.action === 'open') {
    driver = require(x.module);
    const fd = fs.openSync(x.engine, 'r');
    let data, primary;
    try {
      const entry = fs.fstatSync(fd);
      if (!entry.isFile() || entry.size > 30000000) throw new Error('Mermaid script exceeds renderer budget or is not an ordinary file');
      const bytes = Buffer.allocUnsafe(30000001);
      let length = 0, count;
      while (length < bytes.length && (count = fs.readSync(fd, bytes, length, Math.min(65536, bytes.length - length), null)) !== 0)
        length += count;
      if (length > 30000000) throw new Error('Mermaid script exceeds renderer budget');
      data = bytes.subarray(0, length);
    } catch (error) { primary = error; throw error; }
    finally {
      try { fs.closeSync(fd); }
      catch (error) { throw primary ? new AggregateError([primary, error], 'Mermaid input read failed: ' + String(primary) + '; descriptor close failed: ' + String(error)) : error; }
    }
    browser = await driver.chromium.launch({ headless: true, chromiumSandbox: x.sandbox,
      ...(x.browser ? { executablePath: x.browser } : {}) });
    const context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, serviceWorkers: 'block' });
    await context.route('**/*', route => { blocked.push(route.request().url()); return route.abort(); });
    page = await context.newPage();
    page.setDefaultTimeout(x.timeout);
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    await page.addScriptTag({ content: data.toString('utf8') });
    if (typeof x.core !== 'string' || Buffer.byteLength(x.core) > 100000) throw new Error('Drawing core missing or over budget');
    await page.addScriptTag({ content: x.core });
    if (!await page.evaluate(() => !!window.mermaid && typeof mermaid.render === 'function' && typeof mermaid.initialize === 'function'))
      throw new Error('Supply standalone Mermaid UMD/IIFE exposing window.mermaid');
    return { info: { engine_sha256: crypto.createHash('sha256').update(data).digest('hex'),
      browser: browser.version(), playwright: require(require('node:path').join(x.module, 'package.json')).version,
      font_family: x.font_family, browser_sandbox: x.sandbox, engine_label: x.engine_label,
      backend: 'node-playwright', node: process.version, architecture: process.arch,
      core_sha256: crypto.createHash('sha256').update(x.core).digest('hex'),
      drawing_profile: await page.evaluate(family => GiftMermaidCore.profile(family), x.font_family) } };
  }
  if (x.action === 'render') {
    const rendered = await page.evaluate(input => GiftMermaidCore.render(input), x);
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
