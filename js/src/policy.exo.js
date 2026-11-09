/**
 * @file r-sure's Policy and Claim: a bound policy pays out its premium
 * once, opens claims for the insured, and settles an agreed claim across
 * its lines, each line paying its share once.
 */
import { AmountMath } from '@agoric/ertp';
import { allocate, assertWhole, payable, premiumSplit } from './math.js';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Send } from './send.js' */
/** @import { Terms } from './terms.js' */
/** @import { LineKit } from './syndicate.exo.js' */
/** @import { FundPublic } from './fund.exo.js' */
/** @import { EProxy, Payment, DepositFacet, NatAmount, Purse, Clock } from './types.js' */

const { add, coerce, isEmpty, isGTE, makeEmptyFromAmount, subtract } =
  AmountMath;

const terminal = harden(['settled', 'denied', 'closed']);

/**
 * @typedef {object} PolicyParts
 * @property {Terms} terms
 * @property {(LineKit & { shareBps: number })[]} lines lead first, then second
 * @property {Remote<Purse<'nat'>>} purse holding the premium
 * @property {Remote<DepositFacet>} brokerDeposit
 * @property {FundPublic} fund
 * @property {Remote<DepositFacet>} payout the insured's deposit facet
 */

/** @typedef {{ settle(claim: object, agreed: NatAmount): Promise<NatAmount> }} PolicyClaims */

/**
 * @typedef {object} ClaimInfo
 * @property {number} lossHeight
 * @property {NatAmount} claimedAmount
 * @property {string[]} evidence
 * @property {'standard' | 'complex' | undefined} kind
 * @property {unknown} assessment
 * @property {NatAmount} agreedAmount
 * @property {NatAmount} paid
 * @property {string} status
 */

/**
 * @typedef {object} PolicyInfo
 * @property {Terms} terms
 * @property {NatAmount} aggregatePaid
 * @property {NatAmount} aggregateRemaining
 * @property {boolean} distributed
 * @property {string} status
 * @property {LineKit['view'][]} lines
 */

/**
 * @param {Zone} zone
 * @param {object} powers
 * @param {EProxy} powers.E
 * @param {Remote<Clock>} powers.clock
 * @param {Send} powers.send
 */
export const preparePolicy = (zone, { E, clock, send }) => {
  const makeClaim = zone.exoClassKit(
    'Claim',
    undefined,
    /**
     * @param {PolicyClaims} policy
     * @param {number} lossHeight
     * @param {NatAmount} claimedAmount
     * @param {string[]} evidence
     */
    (policy, lossHeight, claimedAmount, evidence) => ({
      policy,
      lossHeight,
      claimedAmount,
      evidence,
      /** @type {'standard' | 'complex' | undefined} */
      kind: undefined,
      /** @type {unknown} */
      assessment: undefined,
      leadAgreed: false,
      agreedAmount: makeEmptyFromAmount(claimedAmount),
      paid: makeEmptyFromAmount(claimedAmount),
      status: 'notified',
    }),
    {
      view: {
        /** @returns {ClaimInfo} */
        getInfo() {
          const { lossHeight, claimedAmount, evidence, kind } = this.state;
          const { assessment, agreedAmount, paid, status } = this.state;
          return harden({
            lossHeight,
            claimedAmount,
            evidence,
            kind,
            assessment,
            agreedAmount,
            paid,
            status,
          });
        },
        /**
         * Anyone may settle an agreed claim; the policy pays it once.
         *
         * @returns {Promise<NatAmount>} what it paid
         */
        async settle() {
          const { status, agreedAmount, policy } = this.state;
          if (status !== 'agreed') throw Error('not agreed');
          const paid = await policy.settle(this.facets.view, agreedAmount);
          this.state.paid = paid;
          this.state.status = 'settled';
          return paid;
        },
        close() {
          if (!['settled', 'denied'].includes(this.state.status))
            throw Error('not finished');
          this.state.status = 'closed';
        },
      },
      insured: {
        /** @param {string[]} more */
        addEvidence(more) {
          if (['agreed', ...terminal].includes(this.state.status))
            throw Error('closed');
          this.state.evidence = harden([...this.state.evidence, ...more]);
        },
      },
      /** the lead syndicate's manager's */
      lead: {
        /** @param {'standard' | 'complex'} kind */
        classify(kind) {
          this.facets.adjusting.open();
          if (kind !== 'standard' && kind !== 'complex') throw Error('kind');
          this.state.kind = kind;
          this.state.status = 'classified';
        },
        /** @param {unknown} assessment */
        assess(assessment) {
          this.facets.adjusting.assess('lead', assessment);
        },
        /**
         * A standard claim is agreed by the lead alone; a complex one waits
         * for the second.
         *
         * @param {NatAmount} amount
         * @returns {string} the claim's status
         */
        agree(amount) {
          const kind = this.facets.adjusting.classified();
          coerce(this.state.claimedAmount.brand, amount);
          if (kind === 'standard') {
            this.state.agreedAmount = amount;
            this.state.status = 'agreed';
          } else {
            this.state.leadAgreed = true;
            this.state.status = 'assessing';
          }
          return this.state.status;
        },
      },
      /** the second syndicate's manager's */
      second: {
        /** @param {unknown} assessment */
        assess(assessment) {
          this.facets.adjusting.assess('second', assessment);
        },
        /** @param {NatAmount} amount @returns {string} the claim's status */
        agree(amount) {
          const kind = this.facets.adjusting.classified();
          coerce(this.state.claimedAmount.brand, amount);
          if (kind !== 'complex') throw Error('not lead');
          if (!this.state.leadAgreed) throw Error('lead first');
          this.state.agreedAmount = amount;
          this.state.status = 'agreed';
          return this.state.status;
        },
      },
      /** checks the adjusters share */
      adjusting: {
        open() {
          if (terminal.includes(this.state.status)) throw Error('closed');
        },
        /** @returns {'standard' | 'complex'} */
        classified() {
          this.facets.adjusting.open();
          const { kind } = this.state;
          if (!kind) throw Error('not classified');
          return kind;
        },
        /** @param {'lead' | 'second'} by @param {unknown} assessment */
        assess(by, assessment) {
          this.facets.adjusting.open();
          this.state.assessment = harden({ by, assessment });
          this.state.status = 'assessed';
        },
      },
    },
  );

  const makePolicy = zone.exoClassKit(
    'Policy',
    undefined,
    /** @param {PolicyParts} parts */
    ({ terms, lines, purse, brokerDeposit, fund, payout }) => ({
      terms,
      lines,
      purse,
      brokerDeposit,
      fund,
      payout,
      aggregatePaid: makeEmptyFromAmount(terms.aggregateLimit),
      aggregateRemaining: terms.aggregateLimit,
      /** @type {MapStore<object, { status: string; paid: NatAmount }>} */
      claims: zone.detached().mapStore('claims'),
      /** @type {number[]} which of the premium's payouts are done */
      paidOut: harden([]),
      distributing: false,
      distributed: false,
      status: 'active',
    }),
    {
      view: {
        /** @returns {PolicyInfo} */
        getInfo() {
          const { terms, aggregatePaid, aggregateRemaining } = this.state;
          const { distributed, status } = this.state;
          return harden({
            terms,
            aggregatePaid,
            aggregateRemaining,
            distributed,
            status,
            lines: this.state.lines.map(l => l.view),
          });
        },
        /** @param {NatAmount} agreed @returns {NatAmount} */
        payable(agreed) {
          const { terms, aggregateRemaining } = this.state;
          coerce(aggregateRemaining.brand, agreed);
          return payable({ ...terms, agreed, aggregateRemaining });
        },
        /**
         * Pay out the premium: the broker's commission, the central fund's
         * levy, and the rest to the lines by share. Each payout happens
         * once, so a failed distribution can be run again.
         *
         * @returns {Promise<boolean>} whether this call finished it
         */
        async distribute() {
          if (this.state.distributed) return false;
          if (this.state.distributing) throw Error('busy');
          const { terms, lines, purse, brokerDeposit, fund } = this.state;
          const { commission, levy, net } = premiumSplit(
            terms.premiumTotal,
            terms.brokerCommissionBps,
            terms.centralFundBps,
          );
          const parts = allocate(
            net,
            lines.map(l => l.shareBps),
          );
          /** @type {[NatAmount, (payment: Payment<'nat'>) => Promise<unknown>][]} */
          const payouts = [
            [commission, p => E(brokerDeposit).receive(p)],
            [levy, p => fund.contribute(p)],
            ...lines.map(
              (l, i) =>
                /** @type {[NatAmount, (p: Payment<'nat'>) => Promise<NatAmount>]} */ ([
                  parts[i],
                  p => l.policy.credit(p),
                ]),
            ),
          ];
          this.state.distributing = true;
          try {
            for (const [i, [amount, deliver]] of payouts.entries()) {
              if (isEmpty(amount) || this.state.paidOut.includes(i)) continue;
              await send(purse, amount, deliver);
              this.state.paidOut = harden([...this.state.paidOut, i]);
            }
          } finally {
            this.state.distributing = false;
          }
          this.state.distributed = true;
          return true;
        },
        /**
         * Anyone may expire a policy past its period and run-off: its lines
         * give back the capacity they haven't paid out.
         */
        async expire() {
          const now = await E(clock).getHeight();
          const { terms, status, lines } = this.state;
          if (status !== 'active') throw Error('closed');
          if (now <= terms.periodEndHeight + terms.runOffBlocks)
            throw Error('not expired');
          this.state.status = 'expired';
          for (const line of lines) line.policy.release();
        },
      },
      insured: {
        /**
         * Notify a loss within the period, in time. The lead and second
         * syndicates' managers each get their part in adjusting it.
         *
         * @param {object} loss
         * @param {number} loss.lossHeight when the loss happened, on the
         *   market's clock: within the policy period, and no more than
         *   `noticeBlocks` before now
         * @param {NatAmount} loss.claimedAmount
         * @param {string[]} loss.evidence
         * @returns {Promise<Pick<ReturnType<typeof makeClaim>, 'view' | 'insured'>>}
         */
        async openClaim({ lossHeight, claimedAmount, evidence }) {
          assertWhole(lossHeight, 'lossHeight');
          const { aggregateRemaining } = this.state;
          coerce(aggregateRemaining.brand, claimedAmount);
          if (isEmpty(claimedAmount)) throw Error('amount');
          const now = await E(clock).getHeight();
          const { terms, status, lines } = this.state;
          if (status !== 'active') throw Error('not active');
          if (isEmpty(aggregateRemaining)) throw Error('exhausted');
          if (
            lossHeight < terms.periodStartHeight ||
            lossHeight > terms.periodEndHeight ||
            now > lossHeight + terms.noticeBlocks
          )
            throw Error('notice');
          const claim = makeClaim(
            this.facets.claims,
            lossHeight,
            claimedAmount,
            harden([...evidence]),
          );
          this.state.claims.init(
            claim.view,
            harden({
              status: 'notified',
              paid: makeEmptyFromAmount(terms.premiumTotal),
            }),
          );
          const [lead, second] = lines;
          lead.policy.assign(
            claim.view,
            harden({ role: 'lead', adjuster: claim.lead }),
          );
          if (second)
            second.policy.assign(
              claim.view,
              harden({ role: 'second', adjuster: claim.second }),
            );
          return harden({ view: claim.view, insured: claim.insured });
        },
      },
      /** what the policy's claims hold */
      claims: {
        /**
         * Pay `claim` across the lines: what's payable, less any central fund
         * cover, split by share. Each line pays its part once, so a failed
         * settlement can be run again.
         *
         * @param {object} claim
         * @param {NatAmount} agreed
         * @returns {Promise<NatAmount>} what's paid: by the lines, and any cover
         */
        async settle(claim, agreed) {
          const { claims, terms, lines, fund, payout } = this.state;
          const entry = claims.get(claim);
          if (entry.status !== 'notified') throw Error(entry.status);
          const pay = payable({
            ...terms,
            agreed,
            aggregateRemaining: this.state.aggregateRemaining,
          });
          const covered = fund.coveredFor(claim);
          if (!isGTE(pay, covered)) throw Error('cover');
          const linePayable = subtract(pay, covered);
          const parts = allocate(
            linePayable,
            lines.map(l => l.shareBps),
          );
          claims.set(claim, harden({ ...entry, status: 'settling' }));
          this.state.aggregateRemaining = subtract(
            this.state.aggregateRemaining,
            pay,
          );
          try {
            for (const [i, line] of lines.entries()) {
              if (isEmpty(parts[i]) || line.view.paidFor(claim) !== undefined)
                continue;
              await line.policy.pay(claim, parts[i], payout);
            }
          } catch (err) {
            this.state.aggregateRemaining = add(
              this.state.aggregateRemaining,
              pay,
            );
            claims.set(claim, entry);
            throw err;
          }
          this.state.aggregatePaid = add(this.state.aggregatePaid, pay);
          claims.set(claim, harden({ status: 'settled', paid: pay }));
          return pay;
        },
      },
    },
  );
  return { makePolicy, makeClaim };
};

/** @typedef {ReturnType<typeof preparePolicy>['makePolicy']} MakePolicy */
/** @typedef {ReturnType<MakePolicy>} PolicyKit */

/** @typedef {ReturnType<ReturnType<typeof preparePolicy>['makeClaim']>} ClaimKit */
