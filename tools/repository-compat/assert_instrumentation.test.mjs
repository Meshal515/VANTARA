import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertInstrumentation} from './assert_instrumentation.mjs';

test('accepts an exact completed AndroidJUnitRunner result',()=>{
 assertInstrumentation('Time: 1.234\n\nOK (2 tests)\n\nINSTRUMENTATION_CODE: -1\n',2);
});
test('an adb exit code cannot hide test failures or crashes',()=>{
 for(const text of ['FAILURES!!!\nTests run: 2, Failures: 1\nINSTRUMENTATION_CODE: -1',
   'INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0',
   'OK (2 tests)\nINSTRUMENTATION_FAILED: runner failed\nINSTRUMENTATION_CODE: -1'])
   assert.throws(()=>assertInstrumentation(text,2));
});
test('rejects empty, truncated and incomplete test selections',()=>{
 for(const text of ['', 'OK (2 tests)', 'OK (1 test)\nINSTRUMENTATION_CODE: -1'])
   assert.throws(()=>assertInstrumentation(text,2));
});
