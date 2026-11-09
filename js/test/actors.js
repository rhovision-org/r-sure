/**
 * @file The parties to a market, by role: operator, backer, manager,
 * broker, and insured. Each holds only her own authority, in a zone of her
 * own, where she finds it again after a restart; whom else she knows, she's
 * introduced to. {@link makeCast} casts them for
 * docs/case-studies/engineering-cover.md.
 */
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';

/** @import { MapStore, Remote, Zone } from '@vattr/toybox/src/types.js' */
/** @import { Market } from '../src/market.js' */
/** @import { ClaimKit, PolicyKit } from '../src/policy.exo.js' */
/** @import { SlipKit } from '../src/slip.exo.js' */
/** @import { Member, Quoted, SyndicateKit } from '../src/syndicate.exo.js' */
/** @import { Terms } from '../src/terms.js' */
/** @import { prepareMarket } from '../src/market.js' */
/** @import { Brand, DepositFacet, Issuer, NatAmount, Purse } from '../src/types.js' */

const { isGTE, make, min } = AmountMath;

/**
 * `store`'s `key`, made the first time by `make`.
 *
 * @template T
 * @param {MapStore<string, any>} store
 * @param {string} key
 * @param {() => T | Promise<T>} make
 * @returns {Promise<T>}
 */
const provide = async (store, key, make) => {
  if (!store.has(key)) store.init(key, await make());
  return store.get(key);
};

/**
 * A purse of one's own, and its deposit facet, which anyone may pay into.
 *
 * @param {MapStore<string, any>} store
 * @param {Remote<Issuer<'nat'>>} issuer
 */
const provideWallet = async (store, issuer) => {
  /** @type {Remote<Purse<'nat'>>} */
  const purse = await provide(store, 'purse', () => E(issuer).makeEmptyPurse());
  return {
    purse,
    /** @type {Remote<DepositFacet>} */
    deposit: await E(purse).getDepositFacet(),
    /** @returns {Promise<NatAmount>} */
    balance: () => E(purse).getCurrentAmount(),
  };
};

/**
 * The market's operator, who governs its central fund: he hears appeals,
 * and covers what the fund can spare.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {ReturnType<typeof prepareMarket>} powers.provideMarket
 * @param {Brand<'nat'>} powers.brand the market's money
 * @param {NatAmount} [powers.maxCoverPerClaim] the central fund's cap
 */
export const makeOperator = async (
  zone,
  { provideMarket, brand, maxCoverPerClaim = make(brand, 500n) },
) => {
  const { market, governor } = await provideMarket({ maxCoverPerClaim });
  return zone.exo('Operator', undefined, {
    getMarket: () => market,
    /** @param {Remote<ClaimKit['view']>} claim @param {Remote<DepositFacet>} payee */
    hearAppeal: async (claim, payee) => {
      const fund = await E(market).getFund();
      const { balance, maxCoverPerClaim } = await E(fund).getInfo();
      const amount = min(balance, maxCoverPerClaim);
      await E(governor).cover(claim, amount, payee);
      return amount;
    },
  });
};

/** @typedef {Awaited<ReturnType<typeof makeOperator>>} Operator */

/**
 * A backer: she backs syndicates with capital, and may take back what they
 * aren't using.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {string} powers.name hers
 * @param {Remote<Issuer<'nat'>>} powers.issuer
 */
export const makeBacker = async (zone, { name, issuer }) => {
  /** @type {MapStore<string, any>} what she holds, each typed where it's read */
  const mine = zone.mapStore('mine');
  const wallet = await provideWallet(mine, issuer);
  /** @type {MapStore<object, Remote<Member>>} a syndicate, to her membership */
  const memberships = zone.mapStore('memberships');
  return zone.exo('Backer', undefined, {
    getDepositFacet: () => wallet.deposit,
    balance: wallet.balance,
    /** @param {Remote<SyndicateKit['public']>} syndicate @param {NatAmount} amount */
    back: async (syndicate, amount) => {
      const payment = await E(wallet.purse).withdraw(amount);
      memberships.init(syndicate, await E(syndicate).join(payment));
    },
    /** @param {Remote<SyndicateKit['public']>} syndicate @param {NatAmount} amount */
    withdraw: (syndicate, amount) =>
      E(memberships.get(syndicate)).withdraw(amount, wallet.deposit),
  });
};

/**
 * A syndicate's manager: she charters it, quotes for the slips she's
 * offered, and adjusts the claims it's lead or second on. As lead, she
 * classifies a claim over `complexOver` as complex, and agrees to what was
 * claimed; as second, she agrees to a complex claim after the lead.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {Remote<Market>} powers.market
 * @param {string} powers.name hers; her syndicate's is `${name}'s`
 * @param {Brand<'nat'>} powers.brand the market's money
 * @param {NatAmount} [powers.complexOver]
 * @param {string[]} [powers.classes] the coverage classes her syndicate writes
 */
export const makeManager = async (
  zone,
  {
    market,
    name,
    brand,
    complexOver = make(brand, 2000n),
    classes = ['engineering', 'property'],
  },
) => {
  /** @type {MapStore<string, any>} what she holds, each typed where it's read */
  const store = zone.mapStore('mine');
  const kit = await provide(store, 'kit', () =>
    E(market).createSyndicate({
      name: `${name}'s`,
      classes,
    }),
  );
  /** @type {MapStore<object, Remote<Quoted['revoker']>>} a slip, to her quote's revoker */
  const revokers = zone.mapStore('revokers');
  return zone.exo('Manager', undefined, {
    /** her syndicate's public facet */
    getSyndicate: () => kit.public,
    /** @param {Remote<SlipKit['view']>} slip @param {number} shareBps */
    quote: async (slip, shareBps) => {
      const { grant, revoker } = await E(kit.manager).subscribe(slip, shareBps);
      revokers.init(slip, revoker);
      return grant;
    },
    /** @param {Remote<SlipKit['view']>} slip */
    withdrawQuote: slip => E(revokers.get(slip)).revoke(),
    /** @param {Remote<ClaimKit['view']>} claim */
    adjust: async claim => {
      if (!(await E(kit.manager).isAdjuster(claim))) return undefined;
      const { role, adjuster } = await E(kit.manager).getAdjuster(claim);
      const { claimedAmount, kind, status } = await E(claim).getInfo();
      if (role === 'lead')
        await E(adjuster).classify(
          isGTE(complexOver, claimedAmount) ? 'standard' : 'complex',
        );
      // a standard claim is the lead's alone
      else if (kind !== 'complex') return status;
      return E(adjuster).agree(claimedAmount);
    },
  });
};

/** @typedef {Awaited<ReturnType<typeof makeManager>>} Manager */

/**
 * A broker: she opens slips for her clients, places them with her
 * panel of managers, and passes a client's claims to them.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {string} powers.name hers
 * @param {Remote<Issuer<'nat'>>} powers.issuer
 * @param {Remote<Market>} powers.market
 * @param {[Manager, number][]} powers.panel each manager, and the share
 *   she places with her
 */
export const makeBroker = async (zone, { name, issuer, market, panel }) => {
  /** @type {MapStore<string, any>} what she holds, each typed where it's read */
  const store = zone.mapStore('mine');
  const wallet = await provideWallet(store, issuer);
  const broker = await provide(store, 'broker', () =>
    E(market).registerBroker(name, wallet.deposit),
  );
  /**
   * A slip on `terms`, open until `expiryHeight`: its view, and the
   * insured's facet, for her client.
   *
   * @param {Terms} terms
   * @param {number} expiryHeight
   * @returns {Promise<Pick<SlipKit, 'view' | 'insured'>>}
   */
  const openSlip = (terms, expiryHeight) =>
    E(broker).openSlip(terms, expiryHeight);
  return zone.exo('Broker', undefined, {
    commission: wallet.balance,
    openSlip,
    /** @param {Terms} terms @param {number} expiryHeight */
    place: async (terms, expiryHeight) => {
      const slip = await openSlip(terms, expiryHeight);
      for (const [manager, shareBps] of panel)
        await manager.quote(slip.view, shareBps);
      return slip;
    },
    /** @param {Remote<ClaimKit['view']>} claim */
    notifyClaim: async claim => {
      for (const [manager] of panel) await manager.adjust(claim);
    },
  });
};

/** @typedef {Awaited<ReturnType<typeof makeBroker>>} Broker */

/**
 * An insured: she insures her project through her broker, and claims for
 * its losses.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {string} powers.name hers
 * @param {Remote<Issuer<'nat'>>} powers.issuer
 * @param {Broker} powers.broker
 * @param {Terms} powers.terms the cover her project needs
 * @param {number} [powers.quoteBy] the height her slip is open until
 * @param {string[]} [powers.evidence] what she reports with a loss
 */
export const makeInsured = async (
  zone,
  {
    name,
    issuer,
    broker,
    terms,
    quoteBy = 100,
    evidence = ['urn:example:inspection'],
  },
) => {
  /** @type {MapStore<string, any>} what she holds, each typed where it's read */
  const store = zone.mapStore('mine');
  const wallet = await provideWallet(store, issuer);
  /** @type {MapStore<number, Remote<ClaimKit['view']>>} each loss's claim, by its height */
  const claims = zone.mapStore('claims');
  /** @returns {Pick<SlipKit, 'view' | 'insured'>} */
  const slipOf = () => store.get('slip');
  /** @returns {Remote<PolicyKit['insured']>} */
  const policyOf = () => store.get('policy');
  /** Ask for cover, accept the slip, and pay the premium. */
  const requestCover = async () => {
    const slip = await broker.place(terms, quoteBy);
    await E(slip.insured).accept(wallet.deposit);
    const premium = await E(wallet.purse).withdraw(terms.premiumTotal);
    await E(slip.insured).fundPremium(premium);
    store.init('slip', slip);
    return slip.view;
  };
  return zone.exo('Insured', undefined, {
    getDepositFacet: () => wallet.deposit,
    balance: wallet.balance,
    requestCover,
    /** Request cover, and bind it; answer the policy's view. */
    seekCover: async () => {
      const policy = await E(await requestCover()).bind();
      store.init('policy', await E(slipOf().insured).getPolicy());
      return policy;
    },
    /**
     * Report a loss to the policy and to her broker, and answer the claim.
     *
     * @param {number} lossHeight when it happened, on the market's clock;
     *   it names the claim in her later calls
     * @param {NatAmount} claimedAmount
     */
    reportLoss: async (lossHeight, claimedAmount) => {
      const { view } = await E(policyOf()).openClaim({
        lossHeight,
        claimedAmount,
        evidence,
      });
      claims.init(lossHeight, view);
      await broker.notifyClaim(view);
      return view;
    },
    /**
     * Ask the market's operator to cover what he can of a claim.
     *
     * @param {number} lossHeight
     * @param {Operator} operator
     */
    appeal: (lossHeight, operator) =>
      operator.hearAppeal(claims.get(lossHeight), wallet.deposit),
    /** @param {number} lossHeight */
    collect: lossHeight => E(claims.get(lossHeight)).settle(),
  });
};

/**
 * Everyone, introduced: Bea's panel is Lena 50%, Sol 30%, and Tess 20%,
 * so Lena leads and Sol is second.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {Remote<Issuer<'nat'>>} powers.issuer
 * @param {Brand<'nat'>} powers.brand the issuer's
 * @param {ReturnType<typeof prepareMarket>} powers.provideMarket
 * @param {Terms} powers.terms what Ines needs
 * @param {[number, number, number]} [powers.shares] Lena's, Sol's, and
 *   Tess's, in basis points
 */
export const makeCast = async (
  zone,
  { issuer, brand, provideMarket, terms, shares = [5000, 3000, 2000] },
) => {
  const otto = await makeOperator(zone.subZone('Otto'), {
    provideMarket,
    brand,
  });
  const market = otto.getMarket();
  const mia = await makeBacker(zone.subZone('Mia'), { name: 'Mia', issuer });
  /** @param {string} name */
  const makeManagerNamed = name =>
    makeManager(zone.subZone(name), { market, name, brand });
  const lena = await makeManagerNamed('Lena');
  const sol = await makeManagerNamed('Sol');
  const tess = await makeManagerNamed('Tess');
  /** @type {[Manager, number][]} */
  const panel = [lena, sol, tess].map((m, i) => [m, shares[i]]);
  const bea = await makeBroker(zone.subZone('Bea'), {
    name: 'Bea',
    issuer,
    market,
    panel,
  });
  const ines = await makeInsured(zone.subZone('Ines'), {
    name: 'Ines',
    issuer,
    broker: bea,
    terms,
  });
  return { otto, mia, lena, sol, tess, bea, ines };
};
