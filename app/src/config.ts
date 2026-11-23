// Какой vault показывает сайт. Файл vault-config.json пишет скрипт `yarn setup-demo`
// (из корня проекта). Адрес RPC можно переопределить в app/.env.local: VITE_RPC_URL=...
import { PublicKey } from "@solana/web3.js";
import cfg from "./vault-config.json";
import idl from "./idl/simple_vault.json";

export const RPC_URL: string = import.meta.env.VITE_RPC_URL || cfg.rpcUrl;
export const PROGRAM_ID = new PublicKey(idl.address);
export const TOKEN_MINT = new PublicKey(cfg.tokenMint);
export const TOKEN_SYMBOL: string = cfg.tokenSymbol;
export const EXPLORER = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

if (cfg.programId !== idl.address) {
  console.warn(
    `vault-config.json создан для программы ${cfg.programId}, а IDL — ${idl.address}. ` +
      "Запустите yarn sync-idl и yarn setup-demo в корне проекта."
  );
}
