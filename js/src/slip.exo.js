/**
 * @file r-sure's Slip: a broker's placing slip. Syndicates subscribe for
 * shares of it; the insured accepts it and funds the premium; once it's
 * fully subscribed, anyone may bind it into a policy.
 */
import { AmountMath } from '@agoric/ertp';
import { BPS, share } from './math.js';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Send } from './send.js' */
/** @import { Terms } from './terms.js' */
/** @import { LineKit } from './syndicate.exo.js' */
/** @import { MakePolicy, PolicyKit } from './policy.exo.js' */
/** @import { FundPublic } from './fund.exo.js' */
/** @import { EProxy, Payment, DepositFacet, NatAmount, Purse, Clock } from './types.js' */

const { add, isEmpty, isEqual, make, makeEmptyFromAmount } = AmountMath;

/**
 * The exposure a quote for `shareBps` reserves: its share of the aggregate
 * limit, plus one unit for each line there could be (8), since settlement's
 * last line takes the remainder of rounding.
 *
 * @param {Terms} terms
 * @param {number} shareBps
 * @returns {NatAmount}
 */
const exposureFor = ({ aggregateLimit }, shareBps) =>
  add(share(aggregateLimit, shareBps), make(aggregateLimit.brand, 8n));

/**
 * @typedef {object} Subscription
 * @property {object} syndicate its public facet
 * @property {{ openLine(): LineKit; release(): boolean; isOpen(): boolean }} grant
 * @property {number} shareBps
 */

/**
 * The subscriptions whose grants are still open: a manager may revoke one.
 *
 * @param {Subscription[]} subs
 */
const live = subs => harden(subs.filter(s => s.grant.isOpen()));

/** @param {Subscription[]} subs */
const totalBps = subs => subs.reduce((acc, s) => acc + s.shareBps, 0);

/**
 * Lead first: the first to subscribe. Then the second: the largest share of
 * the rest, earliest on a tie. Then the rest, in order.
 *
 * @param {Subscription[]} subs
 */
const leadFirst = subs => {
  const [lead, ...rest] = subs;
  if (!rest.length) return subs;
  const second = rest.reduce((a, b) => (b.shareBps > a.shareBps ? b : a));
  return [lead, second, ...rest.filter(s => s !== second)];
};

/**
 * @param {Zone} zone
 * @param {object} powers
 * @param {EProxy} powers.E
 * @param {Remote<Clock>} powers.clock
 * @param {Send} powers.send
 * @param {MakePolicy} powers.makePolicy
 */
export const prepareSlip = (zone, { E, clock, send, makePolicy }) => {
  /** @type {MapStore<object, Underwriting>} a slip's view, to its own facet */
  const underwriting = zone.mapStore('underwriting');

  /**
   * Where the insured is paid, which she names when she accepts.
   *
   * @param {{ payout: Remote<DepositFacet> | undefined }} state
   */
  const payoutOf = ({ payout }) => {
    if (!payout) throw Error('not accepted');
    return payout;
  };

  const makeSlip = zone.exoClassKit(
    'Slip',
    undefined,
    /**
     * @param {Terms} terms
     * @param {number} expiryHeight
     * @param {Remote<Purse<'nat'>>} purse holds the premium until it binds
     * @param {Remote<DepositFacet>} brokerDeposit where the commission goes
     * @param {FundPublic} fund the central fund, which takes the levy
     */
    (terms, expiryHeight, purse, brokerDeposit, fund) => ({
      terms,
      expiryHeight,
      purse,
      brokerDeposit,
      fund,
      /** @type {Remote<DepositFacet> | undefined} where refunds and claims pay the insured */
      payout: undefined,
      funding: false,
      funded: makeEmptyFromAmount(terms.premiumTotal),
      /** @type {Subscription[]} */
      subs: harden([]),
      /** @type {'open' | 'bound' | 'expired'} */
      status: 'open',
      /** @type {PolicyKit['insured'] | undefined} once bound */
      policy: undefined,
    }),
    {
      view: {
        /** @returns {SlipInfo} */
        getInfo() {
          const { terms, expiryHeight, payout, funded, status } = this.state;
          const subs = live(this.state.subs);
          const subscribedBps = totalBps(subs);
          return harden({
            terms,
            expiryHeight,
            accepted: payout !== undefined,
            funded,
            subscribedBps,
            syndicates: subs.length,
            status:
              status === 'open' && subscribedBps === BPS
                ? 'subscribed'
                : status,
          });
        },
        /**
         * Open a line with each grant, and make the policy, which pays out
         * the premium. Anyone may bind a slip that's ready.
         *
         * @returns {Promise<PolicyKit['view']>}
         */
        async bind() {
          const { terms, funded, status } = this.state;
          if (status !== 'open') throw Error('closed');
          const payout = payoutOf(this.state);
          if (!isEqual(funded, terms.premiumTotal)) throw Error('not funded');
          const subs = live(this.state.subs);
          this.state.subs = subs;
          if (totalBps(subs) !== BPS) throw Error('not fully subscribed');
          if (subs.length < terms.minSyndicates) throw Error('syndicates');
          const lines = leadFirst(subs).map(({ grant, shareBps }) => ({
            shareBps,
            ...grant.openLine(),
          }));
          const { purse, brokerDeposit, fund } = this.state;
          const policy = makePolicy(
            harden({ terms, lines, purse, brokerDeposit, fund, payout }),
          );
          this.state.status = 'bound';
          this.state.policy = policy.insured;
          await policy.view.distribute();
          return policy.view;
        },
        /**
         * Anyone may expire a slip that's past its expiry and not bound: its
         * grants give back their capacity, and the premium goes back to the
         * insured.
         *
         * @returns {Promise<NatAmount>} the premium refunded
         */
        async expire() {
          const now = await E(clock).getHeight();
          const { status, expiryHeight, subs, funded } = this.state;
          if (status !== 'open') throw Error('closed');
          if (now <= expiryHeight) throw Error('not expired');
          this.state.status = 'expired';
          for (const { grant } of subs) grant.release();
          if (isEmpty(funded)) return funded;
          this.state.funded = makeEmptyFromAmount(funded);
          const payout = payoutOf(this.state);
          await send(this.state.purse, funded, p => E(payout).receive(p));
          return funded;
        },
      },
      /** what the broker hands the insured */
      insured: {
        /**
         * Accept the slip's terms, and say where refunds and claims pay.
         *
         * @param {Remote<DepositFacet>} payout a deposit facet
         */
        accept(payout) {
          if (this.state.status !== 'open') throw Error('closed');
          this.state.payout = payout;
        },
        /**
         * @param {Payment<'nat'>} payment the whole premium
         * @returns {Promise<NatAmount>}
         */
        async fundPremium(payment) {
          const { funded, funding, terms } = this.state;
          const payout = payoutOf(this.state);
          if (!isEmpty(funded) || funding) throw Error('already funded');
          this.state.funding = true;
          try {
            const { purse } = this.state;
            const amount = await E(purse).deposit(payment);
            if (
              !isEqual(amount, terms.premiumTotal) ||
              this.state.status === 'expired'
            ) {
              await send(purse, amount, p => E(payout).receive(p));
              throw Error(
                `premium is ${terms.premiumTotal.value}, not ${amount.value}`,
              );
            }
            this.state.funded = amount;
            return amount;
          } finally {
            this.state.funding = false;
          }
        },
        /**
         * The policy's insured facet, once the slip is bound.
         *
         * @returns {PolicyKit['insured']}
         */
        getPolicy() {
          if (!this.state.policy) throw Error('not bound');
          return this.state.policy;
        },
      },
      /** what the market's syndicates reach by the slip's view */
      underwriting: {
        /** @param {number} shareBps @returns {Quote} */
        quoteRequest(shareBps) {
          const { status, terms, expiryHeight } = this.state;
          if (status !== 'open') throw Error('closed');
          if (!Number.isSafeInteger(shareBps) || shareBps < 1 || shareBps > BPS)
            throw Error('share');
          return harden({
            coverageClass: terms.coverageClass,
            exposure: exposureFor(terms, shareBps),
            expiryHeight,
          });
        },
        /**
         * @param {object} syndicate
         * @param {Subscription['grant']} grant
         * @param {number} shareBps
         */
        subscribe(syndicate, grant, shareBps) {
          const { terms } = this.state;
          const subs = live(this.state.subs);
          if (subs.some(s => s.syndicate === syndicate))
            throw Error('duplicate syndicate');
          if (subs.length >= terms.maxSyndicates) throw Error('syndicates');
          if (totalBps(subs) + shareBps > BPS) throw Error('oversubscribed');
          this.state.subs = harden([...subs, { syndicate, grant, shareBps }]);
        },
      },
    },
  );

  /** @type {typeof makeSlip} */
  const makeRegisteredSlip = (...args) => {
    const kit = makeSlip(...args);
    underwriting.init(kit.view, kit.underwriting);
    return kit;
  };

  /** @param {unknown} slip */
  const underwritingOf = slip => {
    if (!underwriting.has(/** @type {object} */ (slip)))
      throw Error('not a slip of this market');
    return underwriting.get(/** @type {object} */ (slip));
  };

  return { makeSlip: makeRegisteredSlip, underwritingOf };
};

/**
 * What the market's syndicates reach by a slip's view.
 *
 * @typedef {object} Underwriting
 * @property {(shareBps: number) => Quote} quoteRequest
 * @property {(syndicate: object, grant: Subscription['grant'], shareBps: number) => void} subscribe
 */

/**
 * What a quote for a share of a slip reserves, and until when.
 *
 * @typedef {{ coverageClass: string; exposure: NatAmount; expiryHeight: number }} Quote
 */

/**
 * @typedef {object} SlipInfo
 * @property {Terms} terms
 * @property {number} expiryHeight
 * @property {boolean} accepted
 * @property {NatAmount} funded
 * @property {number} subscribedBps
 * @property {number} syndicates
 * @property {'open' | 'subscribed' | 'bound' | 'expired'} status
 */

/** @typedef {ReturnType<ReturnType<typeof prepareSlip>['makeSlip']>} SlipKit */
