/**
 * @file r-sure's behavioral vectors, which its Lean model emits
 * (spec/vectors/core.json and spec/lean/RSure/Emit.lean, at 1160bc7), as
 * the port's kinds meet them. Each test is named by its vector; a model
 * step that answers `none` is one the port refuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { prepareFund } from '../src/fund.exo.js';
import { preparePolicy } from '../src/policy.exo.js';
import { makeSend } from '../src/send.js';
import { prepareSyndicate } from '../src/syndicate.exo.js';
import { makeClaimKit, provideBucks, setUp } from './market-fixtures.js';

/** @import { Zone } from '@vattr/toybox/src/types.js' */
/** @import { Underwriting } from '../src/slip.exo.js' */
/** @import { NatAmount } from '../src/types.js' */

const send = makeSend(E);

/**
 * A syndicate with `capital` Bucks, quoting for stand-in slips, each of
 * which asks for the exposure it was made with. Emit.lean's `syn` and
 * `args`.
 *
 * @param {Zone} zone
 * @param {bigint} [capital]
 */
const makeSyndicateBench = async (zone, capital = 1000n) => {
  const { brand, issuer, mint, bucks } = provideBucks(zone.subZone('bucks'));
  const fakes = zone.subZone('fakes');
  const clock = fakes.exo('Clock', undefined, { getHeight: () => 1 });
  const makeSlip = fakes.exoClass('Slip', undefined, () => ({}), {});
  /** @type {Map<unknown, NatAmount>} each stand-in slip, to its exposure */
  const exposures = new Map();
  /** @type {Parameters<Underwriting['subscribe']>[1][]} what the slips were granted */
  const grants = [];
  /** @param {unknown} slip @returns {Underwriting} */
  const underwritingOf = slip =>
    harden({
      quoteRequest: () =>
        harden({
          coverageClass: 'engineering',
          exposure: exposures.get(slip) ?? assert.fail('not a stand-in'),
          expiryHeight: 100,
        }),
      subscribe: (_syndicate, grant) => {
        grants.push(grant);
      },
    });
  const makeSyndicate = prepareSyndicate(zone.subZone('market'), {
    E,
    brand,
    clock,
    send,
    underwritingOf,
  });
  const kit = makeSyndicate(
    'Lena',
    harden(['engineering']),
    issuer.makeEmptyPurse(),
  );
  await kit.public.join(mint.mintPayment(bucks(capital)));
  /** Quote 5000 bps of a slip asking for `exposure`, and answer the slip's grant. */
  const quote = async (/** @type {bigint} */ exposure) => {
    const slip = makeSlip();
    exposures.set(slip, bucks(exposure));
    await kit.manager.subscribe(slip, 5000);
    return grants[grants.length - 1];
  };
  /** capital, committed, written, free, as Emit.lean's `showSyn` */
  const capacity = () => {
    const { capital, committed, written, free } = kit.public.getCapacity();
    return [capital, committed, written, free].map(a => a.value);
  };
  const payee = issuer.makeEmptyPurse().getDepositFacet();
  return { kit, quote, capacity, payee, bucks, fakes };
};

test('synd.quote.free: a quote within free capacity commits its exposure', async () => {
  const { quote, capacity } = await makeSyndicateBench(makeHeapZone());
  await quote(400n);
  assert.deepEqual(capacity(), [1000n, 400n, 0n, 600n]);
});

test('synd.quote.over: a quote past free capacity is refused', async () => {
  const { quote, capacity } = await makeSyndicateBench(makeHeapZone());
  await assert.rejects(quote(1200n), /capacity/);
  assert.deepEqual(capacity(), [1000n, 0n, 0n, 1000n]);
});

test('synd.openLine: a line moves its exposure from committed to written', async () => {
  const { quote, capacity } = await makeSyndicateBench(makeHeapZone());
  (await quote(400n)).openLine();
  assert.deepEqual(capacity(), [1000n, 0n, 400n, 600n]);
});

test('synd.pay.free: paying a loss takes capital and written alike, so free is unchanged', async () => {
  const { quote, capacity, payee, bucks, fakes } =
    await makeSyndicateBench(makeHeapZone());
  const line = (await quote(400n)).openLine();
  const claim = fakes.exo('Claim', undefined, {});
  await line.policy.pay(claim, bucks(100n), payee);
  assert.deepEqual(capacity(), [900n, 0n, 300n, 600n]);
});

test('synd.release.restore: a released line gives back what it wrote', async () => {
  const { quote, capacity } = await makeSyndicateBench(makeHeapZone());
  const line = (await quote(400n)).openLine();
  assert.equal(line.policy.release(), true);
  assert.deepEqual(capacity(), [1000n, 0n, 0n, 1000n]);
});

test('grant.consume.once: a grant opens one line', async () => {
  const { quote } = await makeSyndicateBench(makeHeapZone());
  const grant = await quote(400n);
  grant.openLine();
  assert.throws(() => grant.openLine(), /closed/);
});

test('line.pay.once: a line pays a claim once', async () => {
  const { quote, payee, bucks, fakes } =
    await makeSyndicateBench(makeHeapZone());
  const line = (await quote(500n)).openLine();
  const claim = fakes.exo('Claim', undefined, {});
  await line.policy.pay(claim, bucks(100n), payee);
  await assert.rejects(
    line.policy.pay(claim, bucks(100n), payee),
    /already paid/,
  );
});

test('line.pay.bound: a line pays no more than its exposure', async () => {
  const { quote, payee, bucks, fakes } =
    await makeSyndicateBench(makeHeapZone());
  const line = (await quote(500n)).openLine();
  const claim = fakes.exo('Claim', undefined, {});
  await assert.rejects(line.policy.pay(claim, bucks(600n), payee), /amount/);
});

/**
 * A slip of Bea's, open until height 100, quoted by Lena and Sol at
 * `shares`, and accepted by a client of hers with a wallet of 1000.
 *
 * @param {[number, number]} shares
 */
const placeSlip = async shares => {
  const { bea, lena, sol, terms, bucks, setHeight, makeClientWallet } =
    await setUp(makeHeapZone());
  const { view, insured } = await bea.openSlip(terms, 100);
  await lena.quote(view, shares[0]);
  await sol.quote(view, shares[1]);
  const wallet = await makeClientWallet();
  await E(insured).accept(wallet.deposit);
  /** @param {bigint} value */
  const fund = async value =>
    E(insured).fundPremium(await wallet.pay(bucks(value)));
  return { bea, view, wallet, bucks, setHeight, fund };
};

test('slip.bind.subscribed: a funded slip, fully subscribed, binds', async () => {
  const { view, fund } = await placeSlip([5000, 5000]);
  await fund(1000n);
  await E(view).bind();
  assert.equal((await E(view).getInfo()).status, 'bound');
});

test('slip.bind.under: a slip short of 10000 bps does not bind', async () => {
  const { view, fund } = await placeSlip([5000, 4000]);
  await fund(1000n);
  await assert.rejects(E(view).bind(), /not fully subscribed/);
});

test('slip.bind.unfunded: a slip without its whole premium does not bind', async () => {
  const { view, fund } = await placeSlip([5000, 5000]);
  // the model's slip holds 90 of 100; the port refuses a short premium
  // outright, so the slip holds none
  await assert.rejects(fund(900n), /premium is 1000, not 900/);
  await assert.rejects(E(view).bind(), /not funded/);
});

test('slip.expire.refund: an expired slip refunds the premium it holds', async () => {
  const { view, wallet, bucks, setHeight, fund } = await placeSlip([
    5000, 5000,
  ]);
  await fund(1000n);
  setHeight(101);
  assert.deepEqual(await E(view).expire(), bucks(1000n));
  assert.deepEqual(await wallet.balance(), bucks(1000n));
});

test('distribution.run.twice: a premium is paid out once', async () => {
  const { bea, view, bucks, fund } = await placeSlip([5000, 5000]);
  await fund(1000n);
  const policy = await E(view).bind();
  // the model refuses a second run; the port's is a no-op
  assert.equal(await E(policy).distribute(), false);
  assert.deepEqual(await bea.commission(), bucks(100n));
});

/**
 * A policy over two stand-in lines at 5000 bps each, which pay whatever
 * they're asked. Emit.lean's `pol`: aggregate 1000, 800 per claim, and a
 * 100 deductible.
 *
 * @param {Zone} zone
 */
const makePolicyBench = zone => {
  const { issuer, bucks } = provideBucks(zone.subZone('bucks'));
  const fakes = zone.subZone('fakes');
  const clock = fakes.exo('Clock', undefined, { getHeight: () => 20 });
  const makeLine = fakes.exoClassKit('Line', undefined, () => ({}), {
    view: {
      /** @param {object} _claim @returns {NatAmount | undefined} */
      paidFor(_claim) {
        return undefined;
      },
    },
    policy: {
      /** @param {import('@agoric/ertp').Payment<'nat'>} _payment @returns {Promise<NatAmount>} */
      async credit(_payment) {
        return bucks(0n);
      },
      /** @param {object} _claim @param {NatAmount} amount @returns {Promise<NatAmount>} */
      async pay(_claim, amount) {
        return amount;
      },
      release() {
        return true;
      },
      assign() {},
    },
  });
  const makeFund = prepareFund(zone.subZone('fund'), { E, send });
  const { makePolicy } = preparePolicy(zone.subZone('policy'), {
    E,
    clock,
    send,
  });
  const deposit = () => issuer.makeEmptyPurse().getDepositFacet();
  const terms = harden({
    coverageClass: 'engineering',
    aggregateLimit: bucks(1000n),
    perClaimLimit: bucks(800n),
    deductible: bucks(100n),
    premiumTotal: bucks(1000n),
    periodStartHeight: 10,
    periodEndHeight: 1000,
    waitingBlocks: 0,
    noticeBlocks: 50,
    runOffBlocks: 20,
    standardClaimMax: bucks(800n),
    minSyndicates: 1,
    maxSyndicates: 8,
    brokerCommissionBps: 1000,
    centralFundBps: 500,
    evidencePolicy: /** @type {const} */ ('optional'),
    claimsLeadPolicy: /** @type {const} */ ('lead+second'),
  });
  const kit = makePolicy(
    harden({
      terms,
      lines: [makeLine(), makeLine()].map(l =>
        harden({ ...l, shareBps: 5000 }),
      ),
      purse: issuer.makeEmptyPurse(),
      brokerDeposit: deposit(),
      fund: makeFund(issuer.makeEmptyPurse(), bucks(500n)).public,
      payout: deposit(),
    }),
  );
  /** Open a claim for a loss at height 15, and settle `agreed` of it. */
  const settle = async (/** @type {bigint} */ agreed) => {
    const { view } = await kit.insured.openClaim({
      lossHeight: 15,
      claimedAmount: bucks(agreed),
      evidence: [],
    });
    return kit.claims.settle(view, bucks(agreed));
  };
  const remaining = () => kit.view.getInfo().aggregateRemaining.value;
  return { settle, remaining };
};

test('policy.settle.aggregate: a settlement takes what it pays from the aggregate', async () => {
  const { settle, remaining } = makePolicyBench(makeHeapZone());
  // 1000 agreed: capped at 800 per claim, less 100 is 700
  assert.equal((await settle(1000n)).value, 700n);
  assert.equal(remaining(), 300n);
});

test('policy.settle.aggregate-third: what is left of the aggregate caps a settlement', async () => {
  const { settle, remaining } = makePolicyBench(makeHeapZone());
  // 500 agreed pays 400, leaving 600, as the model's policy starts
  await settle(500n);
  assert.equal(remaining(), 600n);
  // 1000 agreed: capped at the 600 left, less 100 is 500
  assert.equal((await settle(1000n)).value, 500n);
  assert.equal(remaining(), 100n);
});

/**
 * The central fund with 1000 Bucks in it, covering at most 500 a claim.
 * Emit.lean's `fund`.
 *
 * @param {Zone} zone
 */
const makeFundBench = async zone => {
  const { issuer, mint, bucks } = provideBucks(zone.subZone('bucks'));
  const makeFund = prepareFund(zone.subZone('fund'), { E, send });
  const fund = makeFund(issuer.makeEmptyPurse(), bucks(500n));
  await fund.public.contribute(mint.mintPayment(bucks(1000n)));
  const claim = zone.subZone('fakes').exo('Claim', undefined, {});
  const payee = issuer.makeEmptyPurse().getDepositFacet();
  /** @param {bigint} value */
  const cover = value => fund.governor.cover(claim, bucks(value), payee);
  return { cover };
};

test('fund.cover.cap: the fund covers no more than its cap', async () => {
  const { cover } = await makeFundBench(makeHeapZone());
  await assert.rejects(cover(600n), /amount/);
});

test('fund.cover.once: the fund covers a claim once', async () => {
  const { cover } = await makeFundBench(makeHeapZone());
  await cover(100n);
  await assert.rejects(cover(100n), /already covered/);
});

test('claim.standard.lead: the lead alone agrees a standard claim', () => {
  const { lead, view, bucks } = makeClaimKit(makeHeapZone(), {
    claimed: 1000n,
  });
  lead.classify('standard');
  assert.equal(lead.agree(bucks(500n)), 'agreed');
  const { status, agreedAmount } = view.getInfo();
  assert.deepEqual([status, agreedAmount.value], ['agreed', 500n]);
});

test('claim.complex.second-first: the second may not agree a complex claim before the lead', () => {
  const { lead, second, bucks } = makeClaimKit(makeHeapZone(), {
    claimed: 1000n,
  });
  lead.classify('complex');
  assert.throws(() => second.agree(bucks(500n)), /lead first/);
});

test('claim.terminal.refused: a settled claim takes no agreement', async () => {
  const { lead, view, bucks } = makeClaimKit(makeHeapZone(), {
    claimed: 1000n,
  });
  lead.classify('standard');
  lead.agree(bucks(1000n));
  await view.settle();
  assert.throws(() => lead.agree(bucks(999n)), /closed/);
});

test.todo('claim.apply.partial-bound: r-gen decisions are not ported');
test.todo('book.register.twice: the books are not ported');
