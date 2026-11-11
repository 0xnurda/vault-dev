/**
 * Неделя 11: свои тестовые токены + свой CLMM-пул на Raydium (devnet).
 *
 * Что делает скрипт:
 *   1. Создаёт два SPL-токена (decimals = 6) и минтит их на твой кошелёк
 *   2. Создаёт CLMM-пул TOKEN_A / TOKEN_B на Raydium devnet
 *   3. Сохраняет адреса в devnet-pool.json (пригодится на неделях 12-13)
 *
 * Запуск:
 *   yarn create-pool
 *
 * Кошелёк: ANCHOR_WALLET или ~/.config/solana/id.json. RPC: DEVNET_RPC или публичный devnet.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Raydium, DEVNET_PROGRAM_ID, DEV_API_URLS, TxVersion } from "@raydium-io/raydium-sdk-v2";
import Decimal from "decimal.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Настройки
// ─────────────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const DECIMALS = 6;
const MINT_AMOUNT = 1_000_000; // сколько токенов каждого вида минтим себе (целых)
const INITIAL_PRICE = 1; // стартовая цена: 1 TOKEN_A = 1 TOKEN_B
const TICK_SPACING = 60; // 60 — стандартный шаг для обычных пар (комиссия 0.25%)
const OUT_FILE = path.join(__dirname, "..", "devnet-pool.json");

function loadWallet(): Keypair {
  const keyPath = process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf-8"))));
}

async function main() {
  const owner = loadWallet();
  const connection = new Connection(RPC_URL, "confirmed");
  console.log("Кошелёк:", owner.publicKey.toBase58());
  console.log("Баланс :", (await connection.getBalance(owner.publicKey)) / 1e9, "SOL");

  // ─── 1. Свои токены ────────────────────────────────────────────────────────
  console.log("\n[1/3] Создаю тестовые токены...");
  const mintA = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  const mintB = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  for (const [name, mint] of [["TOKEN_A", mintA], ["TOKEN_B", mintB]] as const) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
    await mintTo(connection, owner, mint, ata.address, owner, BigInt(MINT_AMOUNT) * BigInt(10 ** DECIMALS));
    console.log(`  ${name}: ${mint.toBase58()} (заминчено ${MINT_AMOUNT})`);
  }

  // ─── 2. CLMM-пул на Raydium ────────────────────────────────────────────────
  console.log("\n[2/3] Создаю CLMM-пул на Raydium devnet...");
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
    urlConfigs: DEV_API_URLS,
  });

  // Конфиг комиссий берём из API Raydium (devnet)
  const configs = await raydium.api.getClmmConfigs();
  const config = configs.find((c) => c.tickSpacing === TICK_SPACING) ?? configs[0];
  if (!config) throw new Error("Raydium API не вернул ни одного CLMM-конфига");
  console.log(`  Конфиг: ${config.id} (tickSpacing=${config.tickSpacing}, fee=${config.tradeFeeRate / 10000}%)`);

  const token = (mint: PublicKey) =>
    ({ address: mint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: DECIMALS } as any);

  const { execute, extInfo } = await raydium.clmm.createPool({
    programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID,
    mint1: token(mintA),
    mint2: token(mintB),
    ammConfig: { ...config, id: new PublicKey(config.id), fundOwner: "", description: "" } as any,
    initialPrice: new Decimal(INITIAL_PRICE),
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const poolId = String((extInfo as any).address.id);
  console.log("  Pool:", poolId);
  console.log("  Tx  :", `https://explorer.solana.com/tx/${txId}?cluster=devnet`);

  // ─── 3. Сохраняем адреса ───────────────────────────────────────────────────
  console.log("\n[3/3] Сохраняю", OUT_FILE);
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        cluster: "devnet",
        clmmProgram: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58(),
        tokenA: mintA.toBase58(),
        tokenB: mintB.toBase58(),
        poolId,
        ammConfig: config.id.toString(),
        tx: txId,
      },
      null,
      2
    ) + "\n"
  );
  console.log("\nГотово. Пул виден на https://explorer.solana.com/address/" + poolId + "?cluster=devnet");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
