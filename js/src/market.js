/**
 * @file An r-sure market in one zone: syndicates, brokers and their slips,
 * policies, claims, and the central fund, all paid in one issuer's money.
 */
import { AmountMath } from '@agoric/ertp';
import { prepareFund } from './fund.exo.js';
import { preparePolicy } from './policy.exo.js';
import { makeSend } from './send.js';
import { prepareSlip } from './slip.exo.js';
import { prepareSyndicate } from './syndicate.exo.js';
import { validateTerms } from './terms.js';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Terms } from './terms.js' */
/** @import { FundPublic } from './fund.exo.js' */
/** @import { EProxy, Brand, DepositFacet, Issuer, NatAmount, Clock } from './types.js' */

/**
 * Define the market's kinds in `zone`, and answer `provideMarket`, which
 * makes the market the first time, and finds it after.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {EProxy} powers.E
 * @param {Remote<Issuer<'nat'>>} powers.issuer whose money the market moves
 * @param {Brand<'nat'>} powers.brand the issuer's, which every amount
 *   the market takes must be in
 * @param {Remote<Clock>} powers.clock whose `getHeight()` is the market's time
 */
export const prepareMarket = (zone, { E, issuer, brand, clock }) => {
  const send = makeSend(E);
  const makeFund = prepareFund(zone, { E, send });
  const { makePolicy } = preparePolicy(zone, { E, clock, send });
  const { makeSlip, underwritingOf } = prepareSlip(zone, {
    E,
    clock,
    send,
    makePolicy,
  });
  const makeSyndicate = prepareSyndicate(zone, {
    E,
    brand,
    clock,
    send,
    underwritingOf,
  });

  const makeBroker = zone.exoClass(
    'Broker',
    undefined,
    /**
     * @param {string} name
     * @param {Remote<DepositFacet>} deposit where its commissions go
     * @param {FundPublic} fund
     */
    (name, deposit, fund) => ({ name, deposit, fund }),
    {
      /**
       * Open a placing slip on `terms`, open to subscription until
       * `expiryHeight`. The `insured` facet is for the broker's client.
       *
       * @param {Terms} terms
       * @param {number} expiryHeight
       */
      async openSlip(terms, expiryHeight) {
        const valid = validateTerms(terms, brand);
        const purse = await E(issuer).makeEmptyPurse();
        const { deposit, fund } = this.state;
        const { view, insured } = makeSlip(
          valid,
          expiryHeight,
          purse,
          deposit,
          fund,
        );
        return harden({ view, insured });
      },
    },
  );

  const makeMarket = zone.exoClass(
    'Market',
    undefined,
    /** @param {FundPublic} fund its public facet */
    fund => ({ fund }),
    {
      /**
       * @param {object} profile
       * @param {string} profile.name
       * @param {string[]} profile.classes the coverage classes it writes
       */
      async createSyndicate({ name, classes }) {
        const purse = await E(issuer).makeEmptyPurse();
        const kit = makeSyndicate(name, harden([...classes]), purse);
        return harden({ public: kit.public, manager: kit.manager });
      },
      /**
       * @param {string} name
       * @param {Remote<DepositFacet>} deposit
       * @returns {ReturnType<typeof makeBroker>}
       */
      registerBroker(name, deposit) {
        return makeBroker(name, deposit, this.state.fund);
      },
      /** @returns {FundPublic} */
      getFund() {
        return this.state.fund;
      },
    },
  );

  /**
   * @type {MapStore<
   *   string,
   *   {
   *     market: ReturnType<typeof makeMarket>;
   *     governor: ReturnType<typeof makeFund>['governor'];
   *   }
   * >}
   */
  const made = zone.mapStore('market');
  /**
   * @param {object} opts
   * @param {NatAmount} opts.maxCoverPerClaim the central fund's cap
   */
  const provideMarket = async ({ maxCoverPerClaim }) => {
    AmountMath.coerce(brand, maxCoverPerClaim);
    if (!made.has('market')) {
      const purse = await E(issuer).makeEmptyPurse();
      const fund = makeFund(purse, maxCoverPerClaim);
      const market = makeMarket(fund.public);
      if (!made.has('market'))
        made.init('market', harden({ market, governor: fund.governor }));
    }
    return made.get('market');
  };
  return provideMarket;
};

/** @typedef {Awaited<ReturnType<ReturnType<typeof prepareMarket>>>['market']} Market */
