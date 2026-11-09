/**
 * @file r-sure's Syndicate, LineGrant, and Line: capital from members, a
 * quote that reserves some of it as a one-shot grant to a slip, and the
 * line the slip opens with that grant when it binds.
 */
import { AmountMath } from '@agoric/ertp';
import { isWithin } from './math.js';

/** @import { Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Send } from './send.js' */
/** @import { Underwriting } from './slip.exo.js' */
/** @import { ClaimKit } from './policy.exo.js' */
/** @import { EProxy, Brand, Payment, DepositFacet, NatAmount, Purse, Clock } from './types.js' */

const {
  add,
  coerce,
  isEmpty,
  isGTE,
  makeEmpty,
  makeEmptyFromAmount,
  subtract,
} = AmountMath;

/**
 * What of a syndicate's capital no quote or line is using.
 *
 * @param {{ capital: NatAmount; committed: NatAmount; written: NatAmount }} books
 */
const freeOf = ({ capital, committed, written }) =>
  subtract(subtract(capital, committed), written);

/**
 * @param {Zone} zone
 * @param {object} powers
 * @param {EProxy} powers.E
 * @param {Brand<'nat'>} powers.brand the market's money
 * @param {Remote<Clock>} powers.clock whose `getHeight()` is the market's time
 * @param {Send} powers.send
 * @param {(slip: unknown) => Underwriting} powers.underwritingOf a slip's
 *   own facet, or a throw if `slip` is not one of this market's
 */
export const prepareSyndicate = (
  zone,
  { E, brand, clock, send, underwritingOf },
) => {
  const makeLine = zone.exoClassKit(
    'Line',
    undefined,
    /**
     * @param {SyndicateBooks} books
     * @param {number} shareBps
     * @param {NatAmount} exposure
     */
    (books, shareBps, exposure) => ({
      books,
      shareBps,
      exposure,
      credited: makeEmptyFromAmount(exposure),
      paid: makeEmptyFromAmount(exposure),
      /** @type {import('@vattr/toybox/src/types.js').MapStore<object, NatAmount>} */
      paidFor: zone.detached().mapStore('paidFor'),
      status: 'bound',
    }),
    {
      view: {
        /** @returns {{ shareBps: number; exposure: NatAmount; credited: NatAmount; paid: NatAmount; status: string }} */
        getInfo() {
          const { shareBps, exposure, credited, paid, status } = this.state;
          return harden({ shareBps, exposure, credited, paid, status });
        },
        /** @param {object} claim @returns {NatAmount | undefined} */
        paidFor(claim) {
          const { paidFor } = this.state;
          return paidFor.has(claim) ? paidFor.get(claim) : undefined;
        },
      },
      /** what only the line's policy holds */
      policy: {
        /**
         * @param {Payment<'nat'>} payment its share of the premium
         * @returns {Promise<NatAmount>}
         */
        async credit(payment) {
          const amount = await this.state.books.depositPremium(payment);
          this.state.credited = add(this.state.credited, amount);
          return amount;
        },
        /**
         * Pay this line's part of `claim`, once.
         *
         * @param {object} claim
         * @param {NatAmount} amount
         * @param {Remote<DepositFacet>} depositFacet the insured's
         * @returns {Promise<NatAmount>}
         */
        async pay(claim, amount, depositFacet) {
          const { paidFor, exposure, paid } = this.state;
          if (paidFor.has(claim)) throw Error('already paid');
          if (!isWithin(amount, subtract(exposure, paid)))
            throw Error('amount');
          paidFor.init(claim, amount);
          this.state.paid = add(paid, amount);
          try {
            await this.state.books.payClaim(amount, depositFacet);
          } catch (err) {
            paidFor.delete(claim);
            this.state.paid = subtract(this.state.paid, amount);
            throw err;
          }
          return amount;
        },
        /**
         * Give back the capacity this line wrote and hasn't paid.
         *
         * @returns {boolean} whether it was still bound
         */
        release() {
          if (this.state.status === 'released') return false;
          this.state.status = 'released';
          this.state.books.unwrite(
            subtract(this.state.exposure, this.state.paid),
          );
          return true;
        },
        /**
         * Hand the syndicate's manager its part in adjusting `claim`.
         *
         * @param {object} claim
         * @param {Assignment} assignment
         */
        assign(claim, assignment) {
          this.state.books.assign(claim, assignment);
        },
      },
    },
  );

  const makeGrant = zone.exoClassKit(
    'LineGrant',
    undefined,
    /**
     * @param {SyndicateBooks} books
     * @param {number} shareBps
     * @param {NatAmount} exposure
     * @param {number} expiryHeight
     */
    (books, shareBps, exposure, expiryHeight) => ({
      books,
      shareBps,
      exposure,
      expiryHeight,
      status: 'open',
    }),
    {
      view: {
        /** @returns {{ shareBps: number; exposure: NatAmount; expiryHeight: number; status: string }} */
        getInfo() {
          const { shareBps, exposure, expiryHeight, status } = this.state;
          return harden({ shareBps, exposure, expiryHeight, status });
        },
        /** Anyone may give back an open grant's capacity once it expires. */
        async expire() {
          const now = await E(clock).getHeight();
          if (this.state.status !== 'open') throw Error('closed');
          if (now <= this.state.expiryHeight) throw Error('not expired');
          this.facets.slip.release();
        },
      },
      /** what only the slip holds */
      slip: {
        /** @returns {boolean} */
        isOpen() {
          return this.state.status === 'open';
        },
        /**
         * Write the reserved capacity as a line.
         *
         * @returns {LineKit}
         */
        openLine() {
          const { books, shareBps, exposure, status } = this.state;
          if (status !== 'open') throw Error('closed');
          this.state.status = 'consumed';
          return books.openLine(shareBps, exposure);
        },
        /** @returns {boolean} whether it was still open */
        release() {
          if (this.state.status !== 'open') return false;
          this.state.status = 'released';
          this.state.books.unreserve(this.state.exposure);
          return true;
        },
      },
      /** what only the syndicate's manager holds */
      manager: {
        revoke() {
          if (!this.facets.slip.release()) throw Error('closed');
        },
      },
    },
  );

  const makeMember = zone.exoClass(
    'Member',
    undefined,
    /** @param {SyndicateBooks} books */
    books => ({
      books,
      contributed: makeEmpty(brand),
      withdrawn: makeEmpty(brand),
    }),
    {
      /** @returns {{ contributed: NatAmount; withdrawn: NatAmount }} */
      getContribution() {
        const { contributed, withdrawn } = this.state;
        return harden({ contributed, withdrawn });
      },
      /** @param {Payment<'nat'>} payment @returns {Promise<NatAmount>} */
      async contribute(payment) {
        const amount = await this.state.books.depositCapital(payment);
        this.state.contributed = add(this.state.contributed, amount);
        return amount;
      },
      /**
       * Take back capital that no quote or line is using.
       *
       * @param {NatAmount} amount
       * @param {Remote<DepositFacet>} depositFacet
       */
      async withdraw(amount, depositFacet) {
        const { contributed, withdrawn } = this.state;
        coerce(brand, amount);
        if (!isWithin(amount, subtract(contributed, withdrawn)))
          throw Error('amount');
        this.state.withdrawn = add(withdrawn, amount);
        try {
          await this.state.books.payCapital(amount, depositFacet);
        } catch (err) {
          this.state.withdrawn = subtract(this.state.withdrawn, amount);
          throw err;
        }
      },
    },
  );

  const makeSyndicate = zone.exoClassKit(
    'Syndicate',
    undefined,
    /**
     * @param {string} name
     * @param {string[]} classes the coverage classes it will write
     * @param {Remote<Purse<'nat'>>} purse its claims purse: capital and premiums
     */
    (name, classes, purse) => ({
      name,
      classes,
      purse,
      capital: makeEmpty(brand),
      committed: makeEmpty(brand),
      written: makeEmpty(brand),
      premiums: makeEmpty(brand),
      claimsPaid: makeEmpty(brand),
      /** @type {import('@vattr/toybox/src/types.js').MapStore<object, Assignment>} */
      adjusters: zone.detached().mapStore('adjusters'),
    }),
    {
      public: {
        /** @returns {{ name: string; classes: string[]; premiums: NatAmount; claimsPaid: NatAmount }} */
        getInfo() {
          const { name, classes, premiums, claimsPaid } = this.state;
          return harden({ name, classes, premiums, claimsPaid });
        },
        /** @returns {{ capital: NatAmount; committed: NatAmount; written: NatAmount; free: NatAmount }} */
        getCapacity() {
          const { capital, committed, written } = this.state;
          const free = freeOf(this.state);
          return harden({ capital, committed, written, free });
        },
        /**
         * Contribute capital, and get the membership that can take it back.
         *
         * @param {Payment<'nat'>} payment
         * @returns {Promise<ReturnType<typeof makeMember>>}
         */
        async join(payment) {
          const member = makeMember(this.facets.books);
          await member.contribute(payment);
          return member;
        },
      },
      manager: {
        /**
         * Quote for `shareBps` of `slip`: reserve its exposure, and give the
         * slip a one-shot grant to write it as a line when it binds.
         *
         * @param {unknown} slip
         * @param {number} shareBps
         * @returns {Promise<{
         *   grant: ReturnType<typeof makeGrant>['view'];
         *   revoker: ReturnType<typeof makeGrant>['manager'];
         * }>}
         */
        async subscribe(slip, shareBps) {
          const now = await E(clock).getHeight();
          const underwriting = underwritingOf(slip);
          const { coverageClass, exposure, expiryHeight } =
            underwriting.quoteRequest(shareBps);
          if (!this.state.classes.includes(coverageClass)) throw Error('class');
          if (expiryHeight <= now) throw Error('quote expired');
          const books = this.facets.books;
          books.reserve(exposure);
          const grant = makeGrant(books, shareBps, exposure, expiryHeight);
          try {
            underwriting.subscribe(this.facets.public, grant.slip, shareBps);
          } catch (err) {
            grant.slip.release();
            throw err;
          }
          return harden({ grant: grant.view, revoker: grant.manager });
        },
        /**
         * Whether this syndicate has a part in adjusting `claim`.
         *
         * @param {object} claim
         * @returns {boolean}
         */
        isAdjuster(claim) {
          return this.state.adjusters.has(claim);
        },
        /**
         * This syndicate's part in adjusting `claim`: its role, lead or
         * second, and the claim's facet for that role.
         *
         * @param {object} claim
         * @returns {Assignment}
         */
        getAdjuster(claim) {
          const { adjusters } = this.state;
          if (!adjusters.has(claim)) throw Error('not ours to adjust');
          return adjusters.get(claim);
        },
      },
      /** what the syndicate's own grants, lines, and members hold */
      books: {
        /** @param {Payment<'nat'>} payment @returns {Promise<NatAmount>} */
        async depositCapital(payment) {
          const amount = await E(this.state.purse).deposit(payment);
          if (isEmpty(amount)) throw Error('amount');
          this.state.capital = add(this.state.capital, amount);
          return amount;
        },
        /** @param {NatAmount} amount @param {Remote<DepositFacet>} depositFacet */
        async payCapital(amount, depositFacet) {
          if (!isGTE(freeOf(this.state), amount)) throw Error('capacity');
          this.state.capital = subtract(this.state.capital, amount);
          try {
            await send(this.state.purse, amount, p =>
              E(depositFacet).receive(p),
            );
          } catch (err) {
            this.state.capital = add(this.state.capital, amount);
            throw err;
          }
        },
        /** @param {NatAmount} exposure */
        reserve(exposure) {
          if (!isGTE(freeOf(this.state), exposure)) throw Error('capacity');
          this.state.committed = add(this.state.committed, exposure);
        },
        /** @param {NatAmount} exposure */
        unreserve(exposure) {
          this.state.committed = subtract(this.state.committed, exposure);
        },
        /**
         * @param {number} shareBps
         * @param {NatAmount} exposure
         * @returns {LineKit}
         */
        openLine(shareBps, exposure) {
          this.state.committed = subtract(this.state.committed, exposure);
          this.state.written = add(this.state.written, exposure);
          return makeLine(this.facets.books, shareBps, exposure);
        },
        /** @param {NatAmount} amount */
        unwrite(amount) {
          this.state.written = subtract(this.state.written, amount);
        },
        /** @param {Payment<'nat'>} payment @returns {Promise<NatAmount>} */
        async depositPremium(payment) {
          const amount = await E(this.state.purse).deposit(payment);
          this.state.premiums = add(this.state.premiums, amount);
          return amount;
        },
        /**
         * A claim payment comes out of capital and the written line alike,
         * so free capacity is unchanged.
         *
         * @param {NatAmount} amount
         * @param {Remote<DepositFacet>} depositFacet
         */
        async payClaim(amount, depositFacet) {
          const { state } = this;
          state.capital = subtract(state.capital, amount);
          state.written = subtract(state.written, amount);
          state.claimsPaid = add(state.claimsPaid, amount);
          try {
            await send(state.purse, amount, p => E(depositFacet).receive(p));
          } catch (err) {
            state.capital = add(state.capital, amount);
            state.written = add(state.written, amount);
            state.claimsPaid = subtract(state.claimsPaid, amount);
            throw err;
          }
        },
        /** @param {object} claim @param {Assignment} assignment */
        assign(claim, assignment) {
          this.state.adjusters.init(claim, assignment);
        },
      },
    },
  );
  return makeSyndicate;
};

/**
 * What a syndicate's own grants, lines, and members hold.
 *
 * @typedef {object} SyndicateBooks
 * @property {(payment: Payment<'nat'>) => Promise<NatAmount>} depositCapital
 * @property {(amount: NatAmount, depositFacet: Remote<DepositFacet>) => Promise<void>} payCapital
 * @property {(exposure: NatAmount) => void} reserve
 * @property {(exposure: NatAmount) => void} unreserve
 * @property {(shareBps: number, exposure: NatAmount) => LineKit} openLine
 * @property {(amount: NatAmount) => void} unwrite
 * @property {(payment: Payment<'nat'>) => Promise<NatAmount>} depositPremium
 * @property {(amount: NatAmount, depositFacet: Remote<DepositFacet>) => Promise<void>} payClaim
 * @property {(claim: object, assignment: Assignment) => void} assign
 */

/**
 * A line's facets: `view` for anyone, `policy` for its policy alone.
 *
 * @typedef {object} LineKit
 * @property {{ paidFor(claim: object): NatAmount | undefined }} view
 * @property {object} policy
 * @property {(payment: Payment<'nat'>) => Promise<NatAmount>} policy.credit
 * @property {(claim: object, amount: NatAmount, depositFacet: Remote<DepositFacet>) => Promise<NatAmount>} policy.pay
 * @property {() => boolean} policy.release
 * @property {(claim: object, assignment: Assignment) => void} policy.assign
 */

/**
 * A syndicate's part in adjusting a claim: as lead, or as second, with the
 * claim's facet for that role.
 *
 * @typedef {{ role: 'lead'; adjuster: ClaimKit['lead'] }
 *   | { role: 'second'; adjuster: ClaimKit['second'] }} Assignment
 */

/** @typedef {ReturnType<ReturnType<typeof prepareSyndicate>>} SyndicateKit */
/** @typedef {Awaited<ReturnType<SyndicateKit['public']['join']>>} Member */
/**
 * What a manager's quote for a slip answers: the grant's view, and what
 * revokes it.
 *
 * @typedef {Awaited<ReturnType<SyndicateKit['manager']['subscribe']>>} Quoted
 */
