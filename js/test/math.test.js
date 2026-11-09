/**
 * @file SureMath and CoverTerms against r-sure's vectors, which its Lean
 * model emits (spec/vectors/core.json, at 1160bc7), in Bucks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { allocate, payable, premiumSplit, share } from '../src/math.js';
import { validateTerms } from '../src/terms.js';
import { makeSampleTerms, provideBucks } from './market-fixtures.js';

const { brand, bucks } = provideBucks(makeHeapZone());
/** @param {import('../src/types.js').NatAmount[]} amounts */
const valuesOf = amounts => amounts.map(a => a.value);

test('math.share: bps of an amount, rounded down', () => {
  assert.deepEqual(share(bucks(1000n), 10000), bucks(1000n)); // math.share.full
  assert.deepEqual(share(bucks(1000n), 5000), bucks(500n)); // math.share.half
  assert.deepEqual(share(bucks(999n), 3333), bucks(332n)); // math.share.trunc
  assert.deepEqual(share(bucks(10n ** 12n), 9999), bucks(999_900_000_000n));
  assert.throws(() => share(bucks(1000n), 10001), /bps/);
  // not one AmountMath would make
  const negative = harden({ brand, value: -1n });
  assert.throws(() => share(negative, 10), /-1/);
});

test('math.alloc: the last share takes the remainder, so the parts sum to the whole', () => {
  // math.alloc.sum
  assert.deepEqual(valuesOf(allocate(bucks(1000n), [5000, 5000])), [
    500n,
    500n,
  ]);
  // math.alloc.remainder
  const parts = valuesOf(allocate(bucks(1001n), [3333, 3333, 3334]));
  assert.deepEqual(parts, [333n, 333n, 335n]);
  assert.equal(
    parts.reduce((a, b) => a + b),
    1001n,
  );
  // distribution.run.sum
  assert.deepEqual(valuesOf(allocate(bucks(1000n), [4000, 6000])), [
    400n,
    600n,
  ]);
  assert.throws(() => allocate(bucks(1000n), [5000, 4000]), /sum to 10000/);
  assert.throws(() => allocate(bucks(1000n), []), /no shares/);
});

test('math.split: commission, levy, and net conserve the premium', () => {
  assert.deepEqual(premiumSplit(bucks(1000n), 1000, 500), {
    commission: bucks(100n),
    levy: bucks(50n),
    net: bucks(850n),
  }); // math.split.conserve
  assert.throws(() => premiumSplit(bucks(1000n), 6000, 5000), /exceed/);
});

test('math.payable: the agreed amount, capped, less the deductible, not below zero', () => {
  /** @param {bigint[]} args agreed, perClaimLimit, aggregateRemaining, deductible */
  const pay = args => {
    const [agreed, perClaimLimit, aggregateRemaining, deductible] =
      args.map(bucks);
    return payable({ agreed, perClaimLimit, aggregateRemaining, deductible })
      .value;
  };
  assert.equal(pay([1000n, 2000n, 600n, 0n]), 600n); // math.payable.aggregate
  assert.equal(pay([1000n, 800n, 600n, 0n]), 600n); // math.payable.aggregate-third
  assert.equal(pay([1000n, 800n, 900n, 100n]), 700n); // math.payable.cap
  assert.equal(pay([1000n, 800n, 900n, 900n]), 0n); // math.payable.deduct
});

test('terms: limits, deductible, and fees are checked before anyone subscribes', () => {
  const sampleTerms = makeSampleTerms(brand);
  assert.deepEqual(validateTerms(sampleTerms, brand), sampleTerms);
  /** @param {Partial<typeof sampleTerms>} change */
  const bad = change => () =>
    validateTerms({ ...sampleTerms, ...change }, brand);
  assert.throws(bad({ coverageClass: 'pets' }), /class/);
  assert.throws(bad({ perClaimLimit: bucks(20_000n) }), /limits/);
  assert.throws(bad({ deductible: bucks(5000n) }), /deductible/);
  assert.throws(
    bad({ brokerCommissionBps: 2000, centralFundBps: 1001 }),
    /bps/,
  );
  assert.throws(bad({ periodEndHeight: 10 }), /period/);
  assert.throws(bad({ premiumTotal: bucks(0n) }), /premiumTotal must be 1/);
  const { brand: otherBrand } = provideBucks(makeHeapZone());
  assert.throws(() => validateTerms(sampleTerms, otherBrand), /brand/i);
});
