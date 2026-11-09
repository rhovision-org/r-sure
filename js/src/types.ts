/**
 * @file What the market needs of the world: ERTP money in natural-number
 * amounts, a clock, and `E` to reach them.
 */
import type { E } from '@endo/far';

export type {
  Brand,
  DepositFacet,
  Issuer,
  NatAmount,
  Payment,
  Purse,
} from '@agoric/ertp';

/** `E`, as given to code that sends to remote objects. */
export type EProxy = typeof E;

/** The market's time: a block height, as r-sure's contracts keep it. */
export interface Clock {
  getHeight(): number;
}
