/**
 * @file A market's parties, in one zone, paid in Bucks: an ertp-books
 * issuer over a GnuCash ledger in memory. The clock is one the test sets.
 */
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import Database from 'better-sqlite3';
import {
  createIssuerKit,
  initGnuCashSchema,
  openIssuerKit,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { prepareMarket } from '../src/market.js';
import { preparePolicy } from '../src/policy.exo.js';
import { makeSend } from '../src/send.js';
import { makeCast } from './actors.js';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Guid } from '@vattr/ertp-books/src/types.js' */
/** @import { Terms } from '../src/terms.js' */
/** @import { Brand, DepositFacet, Issuer, NatAmount, Payment } from '../src/types.js' */

/** @typedef {{ mintPayment(amount: NatAmount): Payment<'nat'> }} Mint */

/**
 * The books outside the vat, which outlast its restarts: a GnuCash ledger
 * in memory, and where its guids come from.
 */
export const makeLedger = () => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  return harden({ db, makeGuid: mockMakeGuid(), nowMs: () => 0 });
};

/** @typedef {ReturnType<typeof makeLedger>} Ledger */

/**
 * Bucks, the market's money: its commodity made in `ledger` the first
 * time, and opened after, with its kinds in `zone`.
 *
 * @param {Zone} zone
 * @param {Ledger} [ledger]
 */
export const provideBucks = (zone, ledger = makeLedger()) => {
  /** @type {MapStore<string, Guid>} */
  const made = zone.mapStore('commodity');
  const booksZone = zone.subZone('books');
  /** @param {{ brand: object; issuer: object; mint: object }} kit ertp-books' */
  const bucksOf = kit => {
    const { brand, issuer, mint } =
      /**
       * ertp-books' kit is ERTP's, but its own copy of ERTP's types lacks
       * the pass-style tags.
       *
       * @type {{ brand: Brand<'nat'>; issuer: Issuer<'nat'>; mint: Mint }}
       */ (/** @type {unknown} */ (kit));
    /** @param {bigint} value */
    const bucks = value => AmountMath.make(brand, value);
    return { brand, issuer, mint, bucks };
  };
  if (made.has('Bucks')) {
    const commodityGuid = made.get('Bucks');
    return bucksOf(
      openIssuerKit({ ...ledger, commodityGuid, zone: booksZone }).kit,
    );
  }
  const kit = createIssuerKit({
    ...ledger,
    commodity: { namespace: 'CURRENCY', mnemonic: 'Bucks' },
    zone: booksZone,
  });
  made.init('Bucks', kit.commodityGuid);
  return bucksOf(kit);
};

/**
 * Terms for an engineering cover, in `brand`'s money.
 *
 * @param {Brand<'nat'>} brand
 * @returns {Terms}
 */
export const makeSampleTerms = brand => {
  /** @param {bigint} value */
  const bucks = value => AmountMath.make(brand, value);
  return harden({
    coverageClass: 'engineering',
    aggregateLimit: bucks(10_000n),
    perClaimLimit: bucks(5000n),
    deductible: bucks(100n),
    premiumTotal: bucks(1000n),
    periodStartHeight: 10,
    periodEndHeight: 1000,
    waitingBlocks: 0,
    noticeBlocks: 50,
    runOffBlocks: 20,
    standardClaimMax: bucks(2000n),
    minSyndicates: 1,
    maxSyndicates: 8,
    brokerCommissionBps: 1000,
    centralFundBps: 500,
    evidencePolicy: 'optional',
    claimsLeadPolicy: 'lead+second',
  });
};

/**
 * Define the money's kinds and the market's in `zone`, as a vat would each
 * time it starts.
 *
 * @param {Zone} zone
 * @param {Ledger} [ledger]
 */
export const defineAll = (zone, ledger) => {
  const { brand, issuer, mint, bucks } = provideBucks(
    zone.subZone('bucks'),
    ledger,
  );
  const clockZone = zone.subZone('clock');
  const makeClock = clockZone.exoClassKit(
    'Clock',
    undefined,
    () => ({ height: 0 }),
    {
      clock: {
        /** @returns {number} */
        getHeight() {
          return this.state.height;
        },
      },
      setter: {
        /** @param {number} height */
        setHeight(height) {
          this.state.height = height;
        },
      },
    },
  );
  const { clock, setter } = clockZone.makeOnce('clock', makeClock);
  const provideMarket = prepareMarket(zone.subZone('market'), {
    E,
    issuer,
    brand,
    clock,
  });
  return {
    issuer,
    brand,
    mint,
    bucks,
    provideMarket,
    /** @param {number} height */
    setHeight: height => setter.setHeight(height),
  };
};

/**
 * A purse of Bucks, to pay from and be paid into.
 *
 * @param {Remote<Issuer<'nat'>>} issuer
 * @param {Remote<Mint>} mint
 * @param {NatAmount} [balance]
 */
export const makeWallet = async (issuer, mint, balance) => {
  const purse = await E(issuer).makeEmptyPurse();
  if (balance) await E(purse).deposit(await E(mint).mintPayment(balance));
  return {
    purse,
    deposit: await E(purse).getDepositFacet(),
    balance: () => E(purse).getCurrentAmount(),
    /** @param {NatAmount} amount */
    pay: amount => E(purse).withdraw(amount),
  };
};

/**
 * Everyone, in `zone`, and the world's part: Mia's capital, which she puts
 * into each syndicate, and Ines's funds for her premium, in Bucks.
 *
 * @param {Zone} zone the vat's root zone
 * @param {object} [world]
 * @param {bigint} [world.capital] Mia's
 * @param {bigint} [world.backing] what she puts into each syndicate
 * @param {bigint} [world.funds] Ines's
 * @param {number} [world.height] the clock's, to start
 */
export const setUp = async (
  zone,
  { capital = 30_000n, backing = 10_000n, funds = 1000n, height = 5 } = {},
) => {
  const { issuer, brand, mint, bucks, provideMarket, setHeight } =
    defineAll(zone);
  const terms = makeSampleTerms(brand);
  const cast = await makeCast(zone, { issuer, brand, provideMarket, terms });
  /** @param {{ getDepositFacet(): Remote<DepositFacet> }} who @param {bigint} value */
  const endow = async (who, value) =>
    E(who.getDepositFacet()).receive(await E(mint).mintPayment(bucks(value)));
  await endow(cast.mia, capital);
  await endow(cast.ines, funds);
  for (const manager of [cast.lena, cast.sol, cast.tess])
    await cast.mia.back(manager.getSyndicate(), bucks(backing));
  setHeight(height);
  /**
   * A new client's wallet, for a test that plays one.
   *
   * @param {bigint} [balance]
   */
  const makeClientWallet = (balance = funds) =>
    makeWallet(issuer, mint, bucks(balance));
  return { ...cast, terms, bucks, setHeight, makeClientWallet };
};

/**
 * A claim for Bucks against a fake policy that pays what's agreed.
 *
 * @param {Zone} zone
 * @param {object} [claim]
 * @param {number} [claim.lossHeight]
 * @param {bigint} [claim.claimed] how many Bucks
 * @param {string[]} [claim.evidence]
 */
export const makeClaimKit = (
  zone,
  { lossHeight = 40, claimed = 3000n, evidence = [] } = {},
) => {
  const { bucks } = provideBucks(zone.subZone('bucks'));
  const fakes = zone.subZone('fakes');
  const clock = fakes.exo('Clock', undefined, { getHeight: () => 0 });
  const policy = fakes.exo('Policy', undefined, {
    /** @param {object} _claim @param {NatAmount} agreed */
    settle: async (_claim, agreed) => agreed,
  });
  const { makeClaim } = preparePolicy(zone.subZone('policy'), {
    E,
    clock,
    send: makeSend(E),
  });
  const kit = makeClaim(
    policy,
    lossHeight,
    bucks(claimed),
    harden([...evidence]),
  );
  return { ...kit, bucks };
};
