/** @file Moving money out of a purse, so that a failed delivery leaves it where it was. */

/** @import { Remote } from '@vattr/toybox/src/types.js' */
/** @import { EProxy, NatAmount, Payment, Purse } from './types.js' */

/**
 * @param {EProxy} E
 */
export const makeSend =
  E =>
  /**
   * Withdraw `amount` from `purse` and hand the payment to `deliver`; if
   * that fails, deposit the payment back and rethrow.
   *
   * @template T
   * @param {Remote<Purse<'nat'>>} purse
   * @param {NatAmount} amount
   * @param {(payment: Payment<'nat'>) => Promise<T>} deliver
   * @returns {Promise<T>}
   */
  async (purse, amount, deliver) => {
    const payment = await E(purse).withdraw(amount);
    try {
      return await deliver(payment);
    } catch (err) {
      await E(purse).deposit(payment);
      throw err;
    }
  };

/** @typedef {ReturnType<typeof makeSend>} Send */
