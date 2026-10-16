import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

test('an APK release targets the source commit that produced the artifact',()=>{
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 // The artifact is named for the version package.json declares, so reading it here keeps this
 // assertion about the release script instead of going stale on the next version bump.
 const {version}=JSON.parse(readFileSync('package.json','utf8'));
 const output=execFileSync(process.execPath,['scripts/release-app.mjs','--dry-run','--apk-only'],{encoding:'utf8'});
 assert.ok(output.includes(`--target ${head}`),'release command must bind the tag to the current source commit');
 assert.ok(output.includes(`snas-${version}.apk`),'the release must carry the APK the declared version names');
});
