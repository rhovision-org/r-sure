/**
 * @file r-sure's SureMath: insurance arithmetic on ERTP amounts of one
 * brand, with shares in basis points of {@link BPS}. Division rounds
 * down, and where an amount is split, the last part takes the remainder,
 * so no unit is made or lost.
 */
import { AmountMath } from '@agoric/ertp';

/** @import { NatAmount } from './types.js' */

const { add, isEmpty, isGTE, make, makeEmptyFromAmount, min, subtract } =
  AmountMath;

/** A whole: 10000 basis points. */
export const BPS = 10_000;

/**
 * Throw unless `n` is a whole number, such as a height.
 *
 * @param {number} n
 * @param {string} what what to call it in the error
 */
export const assertWhole = (n, what) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error(`${what} must be a whole number: ${n}`);
};

/** @param {number} bps */
const assertBps = bps => {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > BPS)
    throw Error(`bps must be 0 to ${BPS}: ${bps}`);
};

/**
 * `bps` of `amount`, rounded down.
 *
 * @param {NatAmount} amount
 * @param {number} bps
 * @returns {NatAmount}
 */
export const share = (amount, bps) => {
  assertBps(bps);
  const { brand, value } = AmountMath.coerce(amount.brand, amount);
  return make(brand, (value * BigInt(bps)) / BigInt(BPS));
};

/**
 * Split `amount` by `shares`, which sum to {@link BPS}; the last part takes
 * the remainder. r-sure's `lineShares` and `settlePlan`.
 *
 * @param {NatAmount} amount
 * @param {number[]} shares in bps
 * @returns {NatAmount[]} one part per share, summing to `amount`
 */
export const allocate = (amount, shares) => {
  if (shares.length === 0) throw Error('no shares');
  const sum = shares.reduce((acc, bps) => (assertBps(bps), acc + bps), 0);
  if (sum !== BPS) throw Error(`shares must sum to ${BPS} bps: ${sum}`);
  const parts = shares.slice(0, -1).map(bps => share(amount, bps));
  const allocated = parts.reduce(
    (acc, part) => add(acc, part),
    makeEmptyFromAmount(amount),
  );
  return harden([...parts, subtract(amount, allocated)]);
};

/**
 * Split a premium into the broker's commission, the central fund's levy,
 * and what's left for the lines.
 *
 * @param {NatAmount} premium
 * @param {number} brokerBps
 * @param {number} fundBps
 */
export const premiumSplit = (premium, brokerBps, fundBps) => {
  assertBps(brokerBps);
  assertBps(fundBps);
  if (brokerBps + fundBps > BPS) throw Error('commission and levy exceed 100%');
  const commission = share(premium, brokerBps);
  const levy = share(premium, fundBps);
  const net = subtract(subtract(premium, commission), levy);
  return harden({ commission, levy, net });
};

/**
 * What a claim pays: the agreed amount, capped by the per-claim limit and
 * what's left of the aggregate, less the deductible, and never below zero.
 * All four must be of one brand.
 *
 * @param {object} claim
 * @param {NatAmount} claim.agreed
 * @param {NatAmount} claim.perClaimLimit
 * @param {NatAmount} claim.aggregateRemaining
 * @param {NatAmount} claim.deductible
 * @returns {NatAmount}
 */
export const payable = ({
  agreed,
  perClaimLimit,
  aggregateRemaining,
  deductible,
}) => {
  const cap = min(min(agreed, perClaimLimit), aggregateRemaining);
  return isGTE(cap, deductible)
    ? subtract(cap, deductible)
    : makeEmptyFromAmount(deductible);
};

/**
 * Whether `amount` is more than nothing and at most `limit`.
 *
 * @param {NatAmount} amount
 * @param {NatAmount} limit
 */
export const isWithin = (amount, limit) =>
  !isEmpty(amount) && isGTE(limit, amount);
