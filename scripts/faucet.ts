/**
 * Неделя 14. Выдать пользователю тестовые SOL и TOKEN_A, чтобы он попробовал сайт.
 *
 * Запуск (из корня проекта, кошельком админа — он mint authority TOKEN_A):
 *   yarn faucet <адрес кошелька> [сколько TOKEN_A, по умолчанию 1000]
 *
 * Если SOL у пользователя меньше 0.01, админ переводит ему 0.02 SOL
 * (хватает на карточку, аккаунты токенов и комиссии).
 */
import {
  TokenAccountNotFoundError,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import config from "../app/src/vault-config.json";
import { devnetConnection, errorText, loadAdmin } from "./devnet";

const U64_MAX = BigInt("18446744073709551615");
const MIN_SOL = 0.01 * LAMPORTS_PER_SOL;
const SEND_SOL = 0.02 * LAMPORTS_PER_SOL;

async function main() {
  const [address, amountArg = "1000"] = process.argv.slice(2);
  if (!address) throw new Error("Укажите адрес: yarn faucet <адрес кошелька> [сколько TOKEN_A]");
  if (!/^[1-9]\d*$/.test(amountArg)) throw new Error("Сумма — целое число токенов больше нуля, например 1000");

  let user: PublicKey;
  try {
    user = new PublicKey(address);
  } catch {
    throw new Error(`Неверный адрес кошелька: ${address}`);
  }
  // У PDA и токен-аккаунтов нет приватного ключа — им токены не нужны, нужен адрес кошелька
  if (!PublicKey.isOnCurve(user.toBytes())) {
    throw new Error(`${address} — это адрес PDA или токен-аккаунта, а нужен адрес кошелька (как в Phantom)`);
  }
  const admin = loadAdmin();
  const connection = await devnetConnection();
  const tokenMint = new PublicKey(config.tokenMint);

  const mint = await getMint(connection, tokenMint).catch((e) => {
    if (e instanceof TokenAccountNotFoundError) {
      throw new Error(`${config.tokenSymbol} ${config.tokenMint} не найден в devnet. Проверьте app/src/vault-config.json или запустите yarn setup-demo`);
    }
    throw e;
  });
  if (!mint.mintAuthority?.equals(admin.publicKey)) {
    throw new Error(`Печатать ${config.tokenSymbol} может только ${mint.mintAuthority?.toBase58()}, а не ваш кошелёк`);
  }
  // корневой tsconfig собирает под ES6, где нет литералов 10n — дописываем нули строкой
  const amount = BigInt(amountArg + "0".repeat(mint.decimals));
  if (amount > U64_MAX) throw new Error("Слишком большая сумма");
  const userAta = getAssociatedTokenAddressSync(tokenMint, user);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userAta, user, tokenMint),
    createMintToInstruction(tokenMint, userAta, admin.publicKey, amount)
  );
  const userSol = await connection.getBalance(user);
  if (userSol < MIN_SOL) {
    tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: user, lamports: SEND_SOL }));
  }

  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log(`${user.toBase58()}: +${amountArg} ${config.tokenSymbol}` + (userSol < MIN_SOL ? ", +0.02 SOL" : ""));
  console.log("Транзакция:", sig);
}

main().catch((e) => {
  console.error(errorText(e));
  process.exit(1);
});
