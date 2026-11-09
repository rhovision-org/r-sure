/**
 * @file r-sure's CoverTerms: what a placing slip offers, checked before
 * anyone subscribes to it. Heights are block heights, or whatever the
 * market's clock counts.
 */
import { AmountMath } from '@agoric/ertp';
import { BPS } from './math.js';

/** @import { Brand, NatAmount } from './types.js' */

const { entries, freeze } = Object;

const TRILLION = 1_000_000_000_000;
const MILLION = 1_000_000;

/** Each amount's bounds, inclusive, in its brand's minor units. */
const amountRanges = freeze({
  aggregateLimit: [1n, BigInt(TRILLION)],
  perClaimLimit: [1n, BigInt(TRILLION)],
  deductible: [0n, BigInt(TRILLION)],
  premiumTotal: [1n, BigInt(TRILLION)],
  standardClaimMax: [0n, BigInt(TRILLION)],
});

/** Each number's bounds, inclusive. */
const ranges = freeze({
  periodStartHeight: [0, TRILLION],
  periodEndHeight: [1, TRILLION],
  waitingBlocks: [0, MILLION],
  noticeBlocks: [0, MILLION],
  runOffBlocks: [0, MILLION],
  minSyndicates: [1, 8],
  maxSyndicates: [1, 8],
  brokerCommissionBps: [0, BPS],
  centralFundBps: [0, BPS],
});

const classes = freeze([
  'engineering',
  'property',
  'equipment',
  'liability',
  'marine',
  'cyber',
]);

/**
 * @typedef {{ [K in keyof typeof amountRanges]: NatAmount } & {
 *   [K in keyof typeof ranges]: number;
 * } & {
 *   coverageClass: string;
 *   evidencePolicy: 'none' | 'optional' | 'required';
 *   claimsLeadPolicy: 'lead' | 'lead+second';
 * }} Terms
 */

/**
 * Check `terms`, throwing on the first fault, and answer them hardened.
 *
 * @param {Terms} terms
 * @param {Brand<'nat'>} brand the market's money, which every amount is in
 * @returns {Terms}
 */
export const validateTerms = (terms, brand) => {
  if (!classes.includes(terms.coverageClass)) throw Error('class');
  for (const [key, [min, max]] of entries(amountRanges)) {
    const amount = terms[/** @type {keyof typeof amountRanges} */ (key)];
    const { value } = AmountMath.coerce(brand, amount);
    if (value < min || value > max)
      throw Error(`${key} must be ${min} to ${max}: ${value}`);
  }
  for (const [key, [min, max]] of entries(ranges)) {
    const n = terms[/** @type {keyof typeof ranges} */ (key)];
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw Error(`${key} must be ${min} to ${max}: ${n}`);
  }
  const t = terms;
  if (t.perClaimLimit.value > t.aggregateLimit.value) throw Error('limits');
  if (t.deductible.value >= t.perClaimLimit.value) throw Error('deductible');
  if (t.standardClaimMax.value > t.perClaimLimit.value)
    throw Error('threshold');
  if (t.minSyndicates > t.maxSyndicates) throw Error('syndicates');
  if (t.brokerCommissionBps + t.centralFundBps > 3000) throw Error('bps');
  if (t.periodEndHeight <= t.periodStartHeight) throw Error('period');
  if (!['none', 'optional', 'required'].includes(t.evidencePolicy))
    throw Error('evidence');
  if (!['lead', 'lead+second'].includes(t.claimsLeadPolicy))
    throw Error('claims lead');
  return harden({ ...terms });
};
