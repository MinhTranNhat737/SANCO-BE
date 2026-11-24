import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTrafficGuard,concurrencyGuard} from '../src/traffic-guard.js';

test('Traffic budgets share a key across tabs, expire, and emit bounded anonymous logs',()=>{
  let now=0;const logs=[];const guard=createTrafficGuard({now:()=>now,log:value=>logs.push(JSON.parse(value))});
  for(let i=0;i<60;i++)assert.equal(guard.allow('watch:private-user',60,60000).ok,true);
  for(let i=0;i<1000;i++)assert.equal(guard.allow('watch:private-user',60,60000).ok,false);
  assert.equal(logs.length,1);assert.equal(JSON.stringify(logs).includes('private-user'),false);
  now=60001;assert.equal(guard.allow('watch:private-user',60,60000).ok,true);
});

test('Concurrency slots release exactly once on finish or aborted responses',()=>{
  const guard=concurrencyGuard({maximum:2,perIp:1});
  const response=()=>Object.assign(new EventEmitter(),{code:200,set(){return this;},status(code){this.code=code;return this;},json(){return this;}});
  let entered=0;const first=response();guard({ip:'A'},first,()=>entered++);
  const blocked=response();guard({ip:'A'},blocked,()=>entered++);assert.equal(blocked.code,503);
  first.emit('close');first.emit('finish');guard({ip:'A'},response(),()=>entered++);assert.equal(entered,2);
});
