import { TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";

/**
 * Баланс токена на ATA владельца. 0 — только если аккаунта действительно нет.
 * Любую другую ошибку (429, сеть) пробрасываем: иначе сайт покажет «у вас 0 токенов»,
 * хотя токены на месте, а просто не ответил RPC.
 */
export async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, getAssociatedTokenAddressSync(mint, owner))).amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return 0n;
    throw e;
  }
}
