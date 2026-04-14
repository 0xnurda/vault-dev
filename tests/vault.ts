/**
 * Тесты для Simple Vault на devnet
 *
 * Сценарий:
 *   1. Admin создаёт vault (initialize_vault)
 *   2. Пользователь A вносит 100 токенов → получает shares
 *   3. Пользователь B вносит 50 токенов → получает shares
 *   4. Пользователь A выводит половину своих shares
 *   5. Проверяем балансы и корректность долей
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function airdropIfNeeded(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  minLamports = 0.5 * LAMPORTS_PER_SOL
) {
  const balance = await connection.getBalance(pubkey);
  if (balance < minLamports) {
    const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  Airdrop → ${pubkey.toBase58().slice(0, 8)}... done`);
  }
}

// Читаем баланс токен-аккаунта (возвращает число токенов)
async function tokenBalance(
  connection: anchor.web3.Connection,
  ata: PublicKey
): Promise<bigint> {
  const info = await getAccount(connection, ata);
  return info.amount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const connection = provider.connection;

  // Кошельки участников
  const admin = (provider.wallet as anchor.Wallet).payer;
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  // SPL-токен для практики (создаём сами)
  let tokenMint: PublicKey;

  // Токен-аккаунты пользователей
  let userATokenAccount: PublicKey;
  let userBTokenAccount: PublicKey;

  // Share-аккаунты пользователей
  let userAShareAccount: PublicKey;
  let userBShareAccount: PublicKey;

  // PDAs
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;

  // Количество токенов (decimals = 6, как USDC)
  const TOKEN_DECIMALS = 6;
  const DEPOSIT_A = new BN(100 * 10 ** TOKEN_DECIMALS); // 100 токенов
  const DEPOSIT_B = new BN(50 * 10 ** TOKEN_DECIMALS);  //  50 токенов

  // ─── before: airdrop + создание токена ─────────────────────────────────────
  before(async () => {
    console.log("\n=== Setup ===");

    // Airdrop пользователям (нужен SOL для rent и комиссий)
    await airdropIfNeeded(connection, admin.publicKey, LAMPORTS_PER_SOL);
    await airdropIfNeeded(connection, userA.publicKey, LAMPORTS_PER_SOL);
    await airdropIfNeeded(connection, userB.publicKey, LAMPORTS_PER_SOL);

    // Создаём тестовый SPL-токен (admin = mint authority)
    tokenMint = await createMint(
      connection,
      admin,
      admin.publicKey, // mintAuthority
      null,            // freezeAuthority
      TOKEN_DECIMALS
    );
    console.log(`  Token mint: ${tokenMint.toBase58()}`);

    // Создаём токен-аккаунты для пользователей
    userATokenAccount = await createAccount(connection, admin, tokenMint, userA.publicKey);
    userBTokenAccount = await createAccount(connection, admin, tokenMint, userB.publicKey);

    // Минтим начальные токены пользователям
    await mintTo(connection, admin, tokenMint, userATokenAccount, admin, 1000 * 10 ** TOKEN_DECIMALS);
    await mintTo(connection, admin, tokenMint, userBTokenAccount, admin, 1000 * 10 ** TOKEN_DECIMALS);

    console.log(`  UserA token balance: 1000`);
    console.log(`  UserB token balance: 1000`);

    // Вычисляем PDAs
    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );
    [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );
    [shareMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );

    console.log(`  Vault PDA:        ${vaultStatePDA.toBase58()}`);
    console.log(`  Vault tokens PDA: ${vaultTokenAccountPDA.toBase58()}`);
    console.log(`  Share mint PDA:   ${shareMintPDA.toBase58()}`);

    // Создаём share-аккаунты для пользователей
    // (после initialize_vault, когда share_mint уже создан в chain)
  });

  // ─── 1. initialize_vault ───────────────────────────────────────────────────
  it("initialize_vault: создаёт vault PDA, token account и share mint", async () => {
    const tx = await program.methods
      .initializeVault()
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint: tokenMint,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    console.log(`\n  initialize_vault tx: ${tx}`);

    // Проверяем vault state
    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.totalTokens.toString(), "0");
    assert.equal(vault.totalShares.toString(), "0");

    // Теперь создаём share-аккаунты пользователей (share_mint уже существует)
    userAShareAccount = await createAccount(connection, admin, shareMintPDA, userA.publicKey);
    userBShareAccount = await createAccount(connection, admin, shareMintPDA, userB.publicKey);

    console.log(`  ✓ VaultState.totalTokens = 0, totalShares = 0`);
  });

  // ─── 2. UserA deposit 100 ──────────────────────────────────────────────────
  it("deposit: UserA вносит 100 токенов → получает 100 shares (1:1 первый депозит)", async () => {
    const balanceBefore = await tokenBalance(connection, userATokenAccount);

    const tx = await program.methods
      .deposit(DEPOSIT_A)
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        userTokenAccount: userATokenAccount,
        userShareAccount: userAShareAccount,
        user: userA.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();

    console.log(`\n  UserA deposit tx: ${tx}`);

    const balanceAfter = await tokenBalance(connection, userATokenAccount);
    const sharesAfter = await tokenBalance(connection, userAShareAccount);
    const vault = await program.account.vaultState.fetch(vaultStatePDA);

    console.log(`  Token balance: ${balanceBefore} → ${balanceAfter} (−${DEPOSIT_A})`);
    console.log(`  Shares received: ${sharesAfter}`);
    console.log(`  Vault: tokens=${vault.totalTokens}, shares=${vault.totalShares}`);

    // Первый депозит: shares = tokens (1:1)
    assert.equal(sharesAfter.toString(), DEPOSIT_A.toString());
    assert.equal(vault.totalTokens.toString(), DEPOSIT_A.toString());
    assert.equal(vault.totalShares.toString(), DEPOSIT_A.toString());
    assert.equal(balanceBefore - balanceAfter, BigInt(DEPOSIT_A.toString()));

    console.log(`  ✓ shares = tokens (первый депозит 1:1)`);
  });

  // ─── 3. UserB deposit 50 ───────────────────────────────────────────────────
  it("deposit: UserB вносит 50 токенов → получает 50 shares (соотношение сохраняется)", async () => {
    const tx = await program.methods
      .deposit(DEPOSIT_B)
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        userTokenAccount: userBTokenAccount,
        userShareAccount: userBShareAccount,
        user: userB.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userB])
      .rpc();

    console.log(`\n  UserB deposit tx: ${tx}`);

    const vaultBal = await tokenBalance(connection, vaultTokenAccountPDA);
    const sharesBofB = await tokenBalance(connection, userBShareAccount);
    const vault = await program.account.vaultState.fetch(vaultStatePDA);

    console.log(`  UserB shares: ${sharesBofB}`);
    console.log(`  Vault tokens in account: ${vaultBal}`);
    console.log(`  Vault state: tokens=${vault.totalTokens}, shares=${vault.totalShares}`);

    // При 1:1 соотношении 50 токенов = 50 shares
    assert.equal(sharesBofB.toString(), DEPOSIT_B.toString());
    assert.equal(vault.totalTokens.toString(), DEPOSIT_A.add(DEPOSIT_B).toString());
    assert.equal(vault.totalShares.toString(), DEPOSIT_A.add(DEPOSIT_B).toString());

    // UserA владеет 100/150 = 66.7% vault, UserB — 50/150 = 33.3%
    const sharesA = await tokenBalance(connection, userAShareAccount);
    const total = BigInt(vault.totalShares.toString());
    console.log(
      `  UserA доля: ${Number(sharesA) / Number(total) * 100}%  ` +
      `UserB доля: ${Number(sharesBofB) / Number(total) * 100}%`
    );
    console.log(`  ✓ Доли корректны: A=${sharesA}, B=${sharesBofB}, total=${total}`);
  });

  // ─── 4. UserA withdraw половина shares ─────────────────────────────────────
  it("withdraw: UserA выводит 50 shares → получает 50 токенов обратно", async () => {
    const sharesA = await tokenBalance(connection, userAShareAccount);
    const halfShares = new BN(sharesA.toString()).divn(2);

    const tokensBefore = await tokenBalance(connection, userATokenAccount);

    const tx = await program.methods
      .withdraw(halfShares)
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        userTokenAccount: userATokenAccount,
        userShareAccount: userAShareAccount,
        user: userA.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();

    console.log(`\n  UserA withdraw tx: ${tx}`);

    const sharesAAfter = await tokenBalance(connection, userAShareAccount);
    const tokensAfter = await tokenBalance(connection, userATokenAccount);
    const vault = await program.account.vaultState.fetch(vaultStatePDA);

    const tokensReceived = tokensAfter - tokensBefore;
    console.log(`  Shares сожжено: ${halfShares} (осталось ${sharesAAfter})`);
    console.log(`  Токены получены: +${tokensReceived}`);
    console.log(`  Vault state: tokens=${vault.totalTokens}, shares=${vault.totalShares}`);

    // UserA вывел 50 из 150 tokens = 50 токенов
    assert.equal(tokensReceived.toString(), halfShares.toString());
    assert.equal(sharesAAfter.toString(), halfShares.toString()); // осталось 50 shares

    console.log(`  ✓ Вывод корректен: получено ${tokensReceived} токенов за ${halfShares} shares`);
  });

  // ─── 5. Финальная проверка долей ───────────────────────────────────────────
  it("итог: доли рассчитаны корректно после всех операций", async () => {
    const sharesA = await tokenBalance(connection, userAShareAccount);
    const sharesB = await tokenBalance(connection, userBShareAccount);
    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    const vaultBal = await tokenBalance(connection, vaultTokenAccountPDA);

    const total = BigInt(vault.totalShares.toString());
    const pctA = Number(sharesA) / Number(total) * 100;
    const pctB = Number(sharesB) / Number(total) * 100;

    console.log(`\n=== Финальное состояние ===`);
    console.log(`  Vault tokens (chain):  ${vaultBal}`);
    console.log(`  Vault totalTokens:     ${vault.totalTokens}`);
    console.log(`  Vault totalShares:     ${vault.totalShares}`);
    console.log(`  UserA shares: ${sharesA} (${pctA.toFixed(1)}%)`);
    console.log(`  UserB shares: ${sharesB} (${pctB.toFixed(1)}%)`);

    // UserA: 50 shares, UserB: 50 shares → каждый по 50%
    // Vault: 100 tokens (50 от A вывел, осталось 50 A + 50 B)
    assert.equal(sharesA.toString(), sharesB.toString(), "A и B должны иметь равные доли");
    assert.equal(vault.totalTokens.toString(), vault.totalShares.toString(), "1:1 ratio сохранён");

    // Vault token account должен точно совпадать с totalTokens
    assert.equal(vaultBal.toString(), vault.totalTokens.toString(), "on-chain баланс = state");

    console.log(`  ✓ UserA = UserB = 50% vault`);
    console.log(`  ✓ on-chain баланс совпадает с vault state`);
  });
});
