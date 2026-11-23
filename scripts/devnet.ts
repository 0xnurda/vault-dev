// Общее для скриптов недели 14: кошелёк админа и защита от «не той сети».
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

export const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const WALLET = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, os.homedir());

// Хеш первого блока devnet. У mainnet и testnet он другой — так сеть не перепутать,
// даже если в DEVNET_RPC случайно вставили адрес mainnet.
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export async function devnetConnection(): Promise<Connection> {
  const connection = new Connection(RPC, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(`${RPC} — это не devnet (genesis ${genesis}). Скрипты работают только в devnet.`);
  }
  return connection;
}

export function loadAdmin(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf8"))));
}

/** Текст ошибки: у ошибок spl-token message бывает пустым. */
export const errorText = (e: any) => e?.message || e?.name || String(e);
