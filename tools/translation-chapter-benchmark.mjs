#!/usr/bin/env node
// Import actual exported device evidence; synthetic inputs remain UNVERIFIED.
import { readFile } from 'node:fs/promises';
import { chapterBenchmark } from '../apps/web/lib/translate-perf.js';
if (!process.argv[2]) {
  process.stderr.write('Usage: node tools/translation-chapter-benchmark.mjs <device-evidence.json>\n');
  process.exitCode = 2;
} else {
  const evidence = JSON.parse(await readFile(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(chapterBenchmark(evidence), null, 2) + '\n');
}
