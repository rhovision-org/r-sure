/**
 * @file r-sure's SureFund: the central fund. Every policy pays it a levy;
 * its governor may cover a claim's shortfall, once, up to a cap. A
 * settlement then pays the lines only what the cover didn't.
 */
import { AmountMath } from '@agoric/ertp';
import { isWithin } from './math.js';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Send } from './send.js' */
/** @import { EProxy, Payment, DepositFacet, NatAmount, Purse } from './types.js' */

const { add, coerce, makeEmptyFromAmount, min, subtract } = AmountMath;

/**
 * @param {Zone} zone
 * @param {object} powers
 * @param {EProxy} powers.E
 * @param {Send} powers.send
 */
export const prepareFund = (zone, { E, send }) =>
  zone.exoClassKit(
    'SureFund',
    undefined,
    /** @param {Remote<Purse<'nat'>>} purse @param {NatAmount} maxCoverPerClaim */
    (purse, maxCoverPerClaim) => ({
      purse,
      maxCoverPerClaim,
      balance: makeEmptyFromAmount(maxCoverPerClaim),
      /** @type {MapStore<object, NatAmount>} claim to its cover */
      covers: zone.detached().mapStore('covers'),
    }),
    {
      public: {
        /** @returns {{ balance: NatAmount; maxCoverPerClaim: NatAmount; covered: number }} */
        getInfo() {
          const { balance, maxCoverPerClaim, covers } = this.state;
          return harden({
            balance,
            maxCoverPerClaim,
            covered: covers.getSize(),
          });
        },
        /** @param {object} claim @returns {NatAmount} */
        coveredFor(claim) {
          const { covers, balance } = this.state;
          return covers.has(claim)
            ? covers.get(claim)
            : makeEmptyFromAmount(balance);
        },
        /** @param {Payment<'nat'>} payment @returns {Promise<NatAmount>} */
        async contribute(payment) {
          const amount = await E(this.state.purse).deposit(payment);
          this.state.balance = add(this.state.balance, amount);
          return amount;
        },
      },
      governor: {
        /**
         * Cover part of `claim`, paid to `depositFacet`; once per claim.
         *
         * @param {object} claim
         * @param {NatAmount} amount
         * @param {Remote<DepositFacet>} depositFacet
         */
        async cover(claim, amount, depositFacet) {
          const { covers, balance, maxCoverPerClaim, purse } = this.state;
          coerce(balance.brand, amount);
          if (covers.has(claim)) throw Error('already covered');
          if (!isWithin(amount, min(balance, maxCoverPerClaim)))
            throw Error('amount');
          covers.init(claim, amount);
          this.state.balance = subtract(balance, amount);
          try {
            await send(purse, amount, p => E(depositFacet).receive(p));
          } catch (err) {
            covers.delete(claim);
            this.state.balance = add(this.state.balance, amount);
            throw err;
          }
        },
      },
    },
  );

/**
 * What a policy holds of the central fund: its public facet.
 *
 * @typedef {ReturnType<ReturnType<typeof prepareFund>>['public']} FundPublic
 */
