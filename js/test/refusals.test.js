/**
 * @file What the market refuses: quotes it can't honor, capital in use,
 * slips not ready to bind, and premiums that aren't the slip's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { setUp } from './market-fixtures.js';

test("Lena's quotes are refused past capacity, out of class, twice, or for what isn't a slip", async () => {
  const { bea, lena, sol, terms, bucks } = await setUp(makeHeapZone());
  // 10000 bps of a 20000 aggregate is 20008 of exposure, past her 10000
  const big = await bea.openSlip(
    { ...terms, aggregateLimit: bucks(20_000n) },
    100,
  );
  await assert.rejects(lena.quote(big.view, 10_000), /capacity/);
  const marine = await bea.openSlip({ ...terms, coverageClass: 'marine' }, 100);
  await assert.rejects(lena.quote(marine.view, 5000), /class/);
  await assert.rejects(
    // @ts-expect-error a syndicate, not a slip
    lena.quote(lena.getSyndicate(), 5000),
    /not a slip of this market/,
  );

  const slip = await bea.openSlip(terms, 100);
  await lena.quote(slip.view, 6000);
  await assert.rejects(lena.quote(slip.view, 1000), /duplicate syndicate/);
  await assert.rejects(sol.quote(slip.view, 5000), /oversubscribed/);
  // a refused quote reserves nothing
  assert.deepEqual(
    (await E(sol.getSyndicate()).getCapacity()).committed,
    bucks(0n),
  );
});

test('Mia takes back only the capital no quote or line is using', async () => {
  const { bea, lena, mia, terms, bucks } = await setUp(makeHeapZone());
  const slip = await bea.openSlip(terms, 100);
  await lena.quote(slip.view, 6000);
  // 6008 committed of 10000
  await assert.rejects(
    mia.withdraw(lena.getSyndicate(), bucks(5000n)),
    /capacity/,
  );
  await mia.withdraw(lena.getSyndicate(), bucks(3992n));
  assert.deepEqual(await mia.balance(), bucks(3992n));
});

test('a quote Lena withdraws drops out of the slip, which then expires and refunds Ines', async () => {
  const { ines, lena, sol, tess, bucks, setHeight } =
    await setUp(makeHeapZone());
  const slip = await ines.requestCover();
  assert.equal((await E(slip).getInfo()).status, 'subscribed');
  await lena.withdrawQuote(slip);
  assert.deepEqual(
    (await E(lena.getSyndicate()).getCapacity()).committed,
    bucks(0n),
  );
  await assert.rejects(lena.withdrawQuote(slip), /closed/);
  assert.equal((await E(slip).getInfo()).subscribedBps, 5000);
  await assert.rejects(E(slip).bind(), /not fully subscribed/);

  // anyone may expire it, once it's past its expiry
  await assert.rejects(E(slip).expire(), /not expired/);
  setHeight(101);
  assert.deepEqual(await E(slip).expire(), bucks(1000n));
  assert.deepEqual(await ines.balance(), bucks(1000n));
  for (const m of [sol, tess])
    assert.deepEqual(
      (await E(m.getSyndicate()).getCapacity()).committed,
      bucks(0n),
    );
  await assert.rejects(E(slip).bind(), /closed/);
});

test("a slip binds only accepted and funded; a premium that isn't its own goes back", async () => {
  const { bea, terms, bucks, makeClientWallet } = await setUp(makeHeapZone());
  // the test plays a client of Bea's, with a wallet of 1000
  const wallet = await makeClientWallet();
  const { view, insured } = await bea.openSlip(terms, 100);
  await assert.rejects(E(view).bind(), /not accepted/);
  await assert.rejects(
    E(insured).fundPremium(await wallet.pay(bucks(10n))),
    /not accepted/,
  );
  await E(insured).accept(wallet.deposit);
  await assert.rejects(E(view).bind(), /not funded/);
  await assert.rejects(
    E(insured).fundPremium(await wallet.pay(bucks(900n))),
    /premium is 1000, not 900/,
  );
  // the refused 10 is still in her hand, not the purse; the 900 came back
  assert.deepEqual(await wallet.balance(), bucks(990n));
});
