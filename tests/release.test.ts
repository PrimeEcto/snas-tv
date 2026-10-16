import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('an APK release targets the source commit that produced the artifact',()=>{
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const output=execFileSync(process.execPath,['scripts/release-app.mjs','--dry-run','--apk-only'],{encoding:'utf8'});
 assert.ok(output.includes(`--target ${head}`),'release command must bind the tag to the current source commit');
 assert.ok(output.includes('snas-0.0.3.apk'));
});
