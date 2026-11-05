import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function assertInstrumentation(text,expected) {
  if(/FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|shortMsg=|Process crashed/.test(text))
    throw Error('ANDROID_INSTRUMENTATION_FAILED');
  const count=text.match(/^\s*OK \((\d+) tests?\)\s*$/m)?.[1];
  if(Number(count)!==expected || !/^INSTRUMENTATION_CODE:\s*-1\s*$/m.test(text))
    throw Error('ANDROID_INSTRUMENTATION_PROOF_MISSING');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  assertInstrumentation(readFileSync(process.argv[2],'utf8'),Number(process.argv[3]));
