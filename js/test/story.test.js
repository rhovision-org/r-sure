/**
 * @file docs/case-studies/engineering-cover.md, in a heap zone: Ines
 * insures her project through Bea, with Lena's, Sol's, and Tess's
 * syndicates at 50/30/20, which Mia backs; a defect is claimed and paid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { setUp } from './market-fixtures.js';

/** @import { Manager } from './actors.js' */

/** @param {Manager[]} managers */
const syndicateInfo = managers =>
  Promise.all(managers.map(m => E(m.getSyndicate()).getInfo()));

test('Ines insures her project; a complex defect claim is paid 50/30/20, and free capacity is unchanged', async () => {
  const { ines, bea, otto, lena, sol, tess, bucks, setHeight } =
    await setUp(makeHeapZone());
  const managers = [lena, sol, tess];

  // her project needs cover
  const policy = await ines.seekCover();
  // 10% commission and a 5% levy; the 850 left goes 50/30/20
  assert.deepEqual(await bea.commission(), bucks(100n));
  assert.deepEqual(
    (await E(E(otto.getMarket()).getFund()).getInfo()).balance,
    bucks(50n),
  );
  assert.deepEqual(
    (await syndicateInfo(managers)).map(s => s.premiums),
    [425n, 255n, 170n].map(bucks),
  );
  const before = await E(lena.getSyndicate()).getCapacity();
  assert.deepEqual(before, {
    capital: bucks(10_000n),
    committed: bucks(0n),
    written: bucks(5008n),
    free: bucks(4992n),
  });

  // a defect, reported in time: over 2000, so Lena calls it complex, and
  // Sol agrees after her
  setHeight(200);
  const claim = await ines.reportLoss(180, bucks(3000n));
  const { kind, status } = await E(claim).getInfo();
  assert.deepEqual([kind, status], ['complex', 'agreed']);

  // 3000 less the 100 deductible
  assert.deepEqual(await ines.collect(180), bucks(2900n));
  assert.deepEqual(await ines.balance(), bucks(2900n));
  assert.deepEqual(
    (await syndicateInfo(managers)).map(s => s.claimsPaid),
    [1450n, 870n, 580n].map(bucks),
  );
  assert.deepEqual(await E(lena.getSyndicate()).getCapacity(), {
    capital: bucks(before.capital.value - 1450n),
    committed: bucks(0n),
    written: bucks(before.written.value - 1450n),
    free: before.free,
  });
  assert.deepEqual(
    (await E(policy).getInfo()).aggregateRemaining,
    bucks(7100n),
  );
  await assert.rejects(ines.collect(180), /not agreed/);

  // past the period and run-off, anyone may expire the policy, and the
  // lines give back what they wrote
  setHeight(1021);
  await E(policy).expire();
  assert.deepEqual(await E(lena.getSyndicate()).getCapacity(), {
    capital: bucks(8550n),
    committed: bucks(0n),
    written: bucks(0n),
    free: bucks(8550n),
  });
});

test('Otto covers what the central fund can spare of a claim, and the lines pay the rest', async () => {
  const { ines, otto, lena, sol, tess, bucks, setHeight } =
    await setUp(makeHeapZone());
  await ines.seekCover();
  setHeight(50);
  await ines.reportLoss(40, bucks(1100n));
  // the fund holds the policy's 50 levy
  assert.deepEqual(await ines.appeal(40, otto), bucks(50n));
  await assert.rejects(ines.appeal(40, otto), /already covered/);
  // 1100 less 100 is 1000 payable: 50 from the fund, 950 from the lines
  assert.deepEqual(await ines.collect(40), bucks(1000n));
  assert.deepEqual(await ines.balance(), bucks(1000n));
  assert.deepEqual(
    (await syndicateInfo([lena, sol, tess])).map(s => s.claimsPaid),
    [475n, 285n, 190n].map(bucks),
  );
});

test("a loss within Ines's deductible settles, paying nothing", async () => {
  const { ines, bucks, setHeight } = await setUp(makeHeapZone());
  await ines.seekCover();
  setHeight(50);
  await ines.reportLoss(40, bucks(80n));
  assert.deepEqual(await ines.collect(40), bucks(0n));
  assert.deepEqual(await ines.balance(), bucks(0n));
});

test('a loss reported too late, or from before the period, is refused', async () => {
  const { ines, bucks, setHeight } = await setUp(makeHeapZone());
  await ines.seekCover();
  setHeight(200);
  // the notice period is 50
  await assert.rejects(ines.reportLoss(100, bucks(500n)), /notice/);
  await assert.rejects(ines.reportLoss(5, bucks(500n)), /notice/);
});
