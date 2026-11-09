/**
 * @file A claim's adjusting, by its lead and second, against a policy that
 * pays whatever it's asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { makeClaimKit } from './market-fixtures.js';

test('a standard claim is agreed by the lead alone', async () => {
  const { lead, second, view, bucks } = makeClaimKit(makeHeapZone());
  assert.throws(() => lead.agree(bucks(2500n)), /not classified/);
  lead.classify('standard');
  assert.throws(() => second.agree(bucks(2500n)), /not lead/);
  assert.equal(lead.agree(bucks(2500n)), 'agreed');
  assert.deepEqual(await view.settle(), bucks(2500n));
});

test('a complex claim is agreed by the lead, then the second; a settled one is closed to them', async () => {
  const { lead, second, view, insured, bucks } = makeClaimKit(makeHeapZone());
  assert.throws(
    // @ts-expect-error not a kind
    () => lead.classify('odd'),
    /kind/,
  );
  lead.classify('complex');
  second.assess({ recommendedAmount: 2500 });
  assert.throws(() => second.agree(bucks(2500n)), /lead first/);
  assert.equal(lead.agree(bucks(2500n)), 'assessing');
  await assert.rejects(view.settle(), /not agreed/);
  assert.equal(second.agree(bucks(2500n)), 'agreed');
  assert.throws(() => insured.addEvidence(['late']), /closed/);
  assert.deepEqual(await view.settle(), bucks(2500n));
  assert.throws(() => lead.classify('standard'), /closed/);
  assert.throws(() => second.agree(bucks(1n)), /closed/);
  view.close();
  assert.equal(view.getInfo().status, 'closed');
});
