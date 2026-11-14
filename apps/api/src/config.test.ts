import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from './config.js';
const valid = {DATABASE_URL:'postgresql://localhost/knokh',AUTH_SECRET:'a'.repeat(40),BETTER_AUTH_URL:'http://localhost:3001',FRONTEND_URL:'http://localhost:5173'};
test('optional email provider does not block startup',()=>assert.equal(readConfig(valid).PORT,3001));
test('missing database fails with an actionable message',()=>assert.throws(()=>readConfig({...valid,DATABASE_URL:undefined}),/DATABASE_URL/));
test('weak secrets are rejected',()=>assert.throws(()=>readConfig({...valid,AUTH_SECRET:'short'}),/AUTH_SECRET/));
test('production requires HTTPS',()=>assert.throws(()=>readConfig({...valid,NODE_ENV:'production'}),/HTTPS/));
