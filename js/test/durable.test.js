/**
 * @file The vat holding the market restarts between Ines's binding and her
 * claim: everyone finds what they hold, and the claim is paid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import { makeLiveslots } from '@vattr/toybox/src/vat/liveslots.js';
import { makeMemoryVatstore } from '@vattr/toybox/test/memory-vatstore.js';
import { makeCast } from './actors.js';
import { defineAll, makeLedger, makeSampleTerms } from './market-fixtures.js';

/** @import { Vatstore } from '@vattr/toybox/src/vat/types.js' */
/** @import { Remote } from '@vattr/toybox/src/types.js' */
/** @import { DepositFacet } from '../src/types.js' */
/** @import { Ledger } from './market-fixtures.js' */

/**
 * The vat starting, on `kv`: its kinds defined again, and everyone finding
 * what they hold. The Bucks ledger is outside the vat.
 *
 * @param {Vatstore} kv
 * @param {Ledger} ledger
 */
const start = async (kv, ledger) => {
  const send = () => Promise.reject(Error('no kernel here'));
  const { zone } = makeLiveslots({ send, kv });
  assert.ok(zone);
  const { issuer, brand, mint, bucks, provideMarket, setHeight } = defineAll(
    zone,
    ledger,
  );
  const cast = await makeCast(zone, {
    issuer,
    brand,
    provideMarket,
    terms: makeSampleTerms(brand),
  });
  return { ...cast, mint, bucks, setHeight };
};

test("a policy bound before a restart pays Ines's claim after it", async () => {
  const kv = makeMemoryVatstore();
  const ledger = makeLedger();
  {
    const { mia, ines, lena, sol, tess, mint, bucks, setHeight } = await start(
      kv,
      ledger,
    );
    /** @param {{ getDepositFacet(): Remote<DepositFacet> }} who @param {bigint} value */
    const endow = async (who, value) =>
      E(who.getDepositFacet()).receive(await E(mint).mintPayment(bucks(value)));
    await endow(mia, 30_000n);
    await endow(ines, 1000n);
    for (const manager of [lena, sol, tess])
      await mia.back(manager.getSyndicate(), bucks(10_000n));
    setHeight(5);
    await ines.seekCover();
  }
  {
    const { ines, lena, sol, tess, bucks, setHeight } = await start(kv, ledger);
    setHeight(50);
    await ines.reportLoss(40, bucks(700n));
    // 700 less the 100 deductible, 50/30/20
    assert.deepEqual(await ines.collect(40), bucks(600n));
    assert.deepEqual(await ines.balance(), bucks(600n));
    const paid = await Promise.all(
      [lena, sol, tess].map(
        async m => (await E(m.getSyndicate()).getInfo()).claimsPaid,
      ),
    );
    assert.deepEqual(paid, [300n, 180n, 120n].map(bucks));
  }
});
