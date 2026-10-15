import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentCycles } from '../.output/checkin-runtime/runtime/checkin/agent-cycles.js';
import { AgentError } from '../.output/checkin-runtime/runtime/checkin/protocol.js';

void test('a transient outage retries a whole recovery-first cycle, not the failed mutation', async () => {
  const signal = new AbortController(); const calls = []; let cycle = 0;
  await runAgentCycles({ signal: signal.signal, intervalMs: 5, reconnect: true,
    async cycle() { calls.push('recover'); if (++cycle === 1) { calls.push('start_reply_lost'); throw new AgentError('network_unavailable', true); } calls.push('report_uncertain'); signal.abort(); },
    async pause(ms) { calls.push(`wait:${ms > 0}`); }, random: () => 0,
    report(category) { calls.push(category); },
  });
  assert.deepEqual(calls, ['recover','start_reply_lost','agent_reconnecting','wait:true','recover','report_uncertain']);
});

void test('credential rejection and corrupt journals remain terminal', async () => {
  for (const category of ['request_rejected','journal_corrupt','lifecycle_invalid_policy','invalid_config']) {
    let cycles = 0;
    await assert.rejects(runAgentCycles({signal:new AbortController().signal,intervalMs:5,reconnect:true, async cycle(){cycles++;throw new AgentError(category);}, report(){} }), {category});
    assert.equal(cycles,1);
  }
});

void test('a missing device pauses only this lane and resumes after readiness returns', async () => {
 const controller=new AbortController();let calls=0;const messages=[];
 await runAgentCycles({signal:controller.signal,intervalMs:5,reconnect:true,async cycle(){if(++calls===1)throw new AgentError('device_missing');controller.abort();},async pause(){},report(m){messages.push(m);}});
 assert.equal(calls,2);assert.deepEqual(messages,['device_missing']);
});

void test('legacy once and non-reconnect modes retain bounded failures', async () => {
 for (const options of [{reconnect:false},{reconnect:true,once:true}]) {
  let calls=0;
  await assert.rejects(runAgentCycles({signal:new AbortController().signal,intervalMs:5,...options,async cycle(){calls++;throw new AgentError('network_unavailable',true);},report(){} }),{category:'network_unavailable'});
  assert.equal(calls,1);
 }
});

void test('abort interrupts a backoff without another cycle', async () => {
 const controller=new AbortController();let calls=0;
 const task=runAgentCycles({signal:controller.signal,intervalMs:5000,reconnect:true,async cycle(){calls++;throw new AgentError('network_unavailable',true);},report(){controller.abort();}});
 await task;assert.equal(calls,1);
});
