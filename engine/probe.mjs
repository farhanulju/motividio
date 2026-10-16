#!/usr/bin/env node
/** Evaluate an expression in a comp after load and print it as JSON: node engine/probe.mjs projects/<p> "window.__info" */
import { serve, args, projectDir, urlPath, launch, openComp } from './lib/common.mjs';
const a = args();
const dir = projectDir(a._[0]);
const server = await serve();
const browser = await launch();
// a debugging tool: load even a broken comp, and show what's wrong with it
const { page, comp } = await openComp(browser, `http://127.0.0.1:${server.address().port}${urlPath(dir)}`, { allowErrors: true });
for (const p of comp.problems || []) console.error(`  [${p.kind}] ${p.detail}`);
console.log(JSON.stringify(await page.evaluate(a._[1] || 'window.__info'), null, 1));
await browser.close(); server.close();
