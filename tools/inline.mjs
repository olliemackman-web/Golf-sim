// Inline the Vite build into self-contained HTML files:
//  dist/fairway-empire.html  — a complete standalone page (open directly in a browser)
//  dist/artifact.html        — body-only page content (no <html>/<head> wrapper) for embedding hosts
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+)"[^>]*>/g)].map((m) => m[1]);
const read = (p) => fs.readFileSync(path.join(dist, p.replace(/^\.\//, '')), 'utf8');
const js = scripts.map(read).join('\n').replace(/<\/script/gi, '<\\/script');
const css = styles.map(read).join('\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const body = `<title>Fairway Empire</title>\n${fonts}\n<style>${css}</style>\n<div id="app"></div>\n<script type="module">${js}</script>\n`;
fs.writeFileSync(path.join(dist, 'artifact.html'), body);
const full = `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n${body}</head><body></body></html>\n`;
fs.writeFileSync(path.join(dist, 'fairway-empire.html'), full);
console.log(`artifact.html ${(body.length / 1024).toFixed(0)} KB, fairway-empire.html ${(full.length / 1024).toFixed(0)} KB`);
