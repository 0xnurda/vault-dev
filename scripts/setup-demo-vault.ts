/**
 * Неделя 14. Демо-vault для сайта (app/).
 *
 * Что делает:
 *   1. создаёт новый токен TOKEN_A (6 знаков, mint authority = ваш кошелёк);
 *   2. вызывает initialize_vault для этого токена;
 *   3. записывает адреса в app/src/vault-config.json — сайт будет показывать этот vault.
 *
 * Запуск (из корня проекта):
 *   yarn setup-demo
 * Переменные окружения:
 *   ANCHOR_WALLET  путь к кошельку админа (по умолчанию ~/.config/solana/id.json)
 *   DEVNET_RPC     свой RPC devnet (по умолчанию https://api.devnet.solana.com)
 */
import * as anchor from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import idl from "../app/src/idl/simple_vault.json";
import { devnetConnection, errorText, loadAdmin } from "./devnet";

const CONFIG_PATH = path.join(__dirname, "..", "app", "src", "vault-config.json");

async function main() {
  const admin = loadAdmin();
  const connection = await devnetConnection();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  const program = new anchor.Program(idl as anchor.Idl, provider);

  console.log("Админ:", admin.publicKey.toBase58());
  console.log("Баланс:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  const tokenMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("TOKEN_A:", tokenMint.toBase58());

  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    program.programId
  );
  const sig = await program.methods
    .initializeVault()
    .accounts({ tokenMint, admin: admin.publicKey } as any)
    .rpc();
  console.log("Vault:", vaultState.toBase58());
  console.log("initialize_vault:", sig);

  const config = {
    rpcUrl: "https://api.devnet.solana.com",
    programId: program.programId.toBase58(),
    tokenMint: tokenMint.toBase58(),
    tokenSymbol: "TOKEN_A",
    admin: admin.publicKey.toBase58(),
  };
  if (fs.existsSync(CONFIG_PATH)) {
    const old = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    console.log(`\nВнимание: vault-config.json заменён. Старый TOKEN_A был ${old.tokenMint} (vault на devnet остаётся).`);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nГотово. Адреса записаны в ${path.relative(process.cwd(), CONFIG_PATH)}`);
  console.log("Тестовые токены пользователю: yarn faucet <адрес кошелька>");
}

main().catch((e) => {
  console.error(errorText(e));
  process.exit(1);
});
