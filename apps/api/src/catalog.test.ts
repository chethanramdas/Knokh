import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogQuery} from './catalog.js';
test('catalog pagination is bounded',()=>{assert.equal(catalogQuery.safeParse({pageSize:101}).success,false);assert.equal(catalogQuery.safeParse({page:0}).success,false)});
test('catalog rejects unsupported sort and currencies',()=>{assert.equal(catalogQuery.safeParse({sort:'DROP TABLE products'}).success,false);assert.equal(catalogQuery.safeParse({currency:'usd'}).success,false)});
test('catalog price bounds are consistent',()=>assert.equal(catalogQuery.safeParse({minPrice:500,maxPrice:100}).success,false));
test('catalog accepts valid typed filters',()=>{const q=catalogQuery.parse({page:'2',pageSize:'10',inStock:'true'});assert.equal(q.page,2);assert.equal(q.pageSize,10)});
