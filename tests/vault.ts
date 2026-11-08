/**
 * Тесты simple_vault (недели 8-10)
 *
 * Сценарий (UNIT = 1 токен, decimals = 6, комиссия 1%):
 *   - A вносит 100 → комиссия 1, в vault 99, shares 99
 *   - B вносит 50  → комиссия 0.5, в vault 49.5, shares 49.5
 *   - A выводит 50 shares → получает 50 токенов
 *   - B выводит все shares → получает 49.5 токенов
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<any>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate(); // без карточки
  const feeWallet = Keypair.generate();

  const UNIT = 1_000_000; // decimals = 6

  let tokenMint: PublicKey;
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;
  let feeTokenAcc: PublicKey;

  const tokenAcc: Record<string, PublicKey> = {};
  const shareAcc: Record<string, PublicKey> = {};

  // ── helpers ────────────────────────────────────────────────────────────────

  const key = (u: Keypair) => u.publicKey.toBase58();

  const fund = async (to: PublicKey, sol = 0.05) => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: to,
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      })
    );
    await provider.sendAndConfirm(tx);
  };

  const cardPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePDA.toBuffer(), user.toBuffer()],
      program.programId
    )[0];

  const bal = async (acc: PublicKey) =>
    (await getAccount(provider.connection, acc)).amount;

  const expectFail = async (p: Promise<unknown>, code?: string) => {
    let err: any = null;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    assert.isNotNull(err, "транзакция должна была упасть");
    if (code) {
      const text = `${err?.error?.errorCode?.code ?? ""} ${String(err)}`;
      assert.include(text, code);
    }
  };

  const createCard = (user: Keypair) =>
    program.methods
      .createUserCard()
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();

  const closeCard = (user: Keypair) =>
    program.methods
      .closeUserCard()
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();

  const setPaused = (signer: Keypair, paused: boolean) =>
    program.methods
      .setPaused(paused)
      .accounts({
        vaultState: vaultStatePDA,
        admin: signer.publicKey,
      } as any)
      .signers([signer])
      .rpc();

  const deposit = (user: Keypair, amount: number) =>
    program.methods
      .deposit(new anchor.BN(amount))
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        feeTokenAccount: feeTokenAcc,
        userTokenAccount: tokenAcc[key(user)],
        userShareAccount: shareAcc[key(user)],
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();

  const withdraw = (user: Keypair, sharesAmount: number) =>
    program.methods
      .withdraw(new anchor.BN(sharesAmount))
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        userTokenAccount: tokenAcc[key(user)],
        userShareAccount: shareAcc[key(user)],
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();

  // ── setup ──────────────────────────────────────────────────────────────────

  before(async () => {
    for (const u of [userA, userB, userC]) {
      await fund(u.publicKey);
    }

    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

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

    // токен-аккаунт для комиссии
    feeTokenAcc = await createAccount(
      provider.connection,
      admin,
      tokenMint,
      feeWallet.publicKey
    );
  });

  // ── week 8 ─────────────────────────────────────────────────────────────────

  it("initialize_vault: vault создан", async () => {
    await program.methods
      .initializeVault(feeWallet.publicKey)
      .accounts({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      } as any)
      .rpc();

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.shareMint.toBase58(), shareMintPDA.toBase58());
    assert.equal(vault.feeWallet.toBase58(), feeWallet.publicKey.toBase58());
    assert.equal(vault.totalTokens.toNumber(), 0);
    assert.equal(vault.totalShares.toNumber(), 0);
    assert.isFalse(vault.paused);

    // теперь share mint существует — создаём аккаунты пользователей
    for (const user of [userA, userB, userC]) {
      tokenAcc[key(user)] = await createAccount(
        provider.connection,
        admin,
        tokenMint,
        user.publicKey
      );
      shareAcc[key(user)] = await createAccount(
        provider.connection,
        admin,
        shareMintPDA,
        user.publicKey
      );
      await mintTo(
        provider.connection,
        admin,
        tokenMint,
        tokenAcc[key(user)],
        admin,
        1000 * UNIT
      );
    }
  });

  it("create_user_card: у A и B своя карточка", async () => {
    await createCard(userA);
    await createCard(userB);

    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.owner.toBase58(), userA.publicKey.toBase58());
    assert.equal(card.vault.toBase58(), vaultStatePDA.toBase58());
    assert.equal(card.deposited.toNumber(), 0);
    assert.equal(card.shares.toNumber(), 0);
    assert.isAbove(card.createdAt.toNumber(), 0);
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    await expectFail(createCard(userA));
  });

  // ── week 9: deposit ────────────────────────────────────────────────────────

  it("deposit: A вносит 100 → 1 комиссия, 99 в vault, 99 shares", async () => {
    await deposit(userA, 100 * UNIT);

    assert.equal(await bal(shareAcc[key(userA)]), BigInt(99 * UNIT));
    assert.equal(await bal(feeTokenAcc), BigInt(1 * UNIT));
    assert.equal(await bal(vaultTokenAccountPDA), BigInt(99 * UNIT));
    assert.equal(await bal(tokenAcc[key(userA)]), BigInt(900 * UNIT));

    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.deposited.toNumber(), 99 * UNIT);
    assert.equal(card.shares.toNumber(), 99 * UNIT);
  });

  it("deposit: B вносит 50 → 0.5 комиссия, 49.5 в vault, 49.5 shares", async () => {
    await deposit(userB, 50 * UNIT);

    assert.equal(await bal(shareAcc[key(userB)]), BigInt(49_500_000));
    assert.equal(await bal(feeTokenAcc), BigInt(1_500_000));

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.totalTokens.toNumber(), 148_500_000);
    assert.equal(vault.totalShares.toNumber(), 148_500_000);
    assert.equal(await bal(vaultTokenAccountPDA), BigInt(148_500_000));
  });

  it("deposit: без карточки — ошибка", async () => {
    await expectFail(deposit(userC, 10 * UNIT), "AccountNotInitialized");
  });

  it("deposit: сумма 0 — ошибка", async () => {
    await expectFail(deposit(userA, 0), "ZeroAmount");
  });

  it("deposit: меньше минимума — ошибка", async () => {
    await expectFail(deposit(userA, 50), "DepositTooSmall");
  });

  it("paused: депозит и создание карточки блокируются, не-админ не может ставить паузу", async () => {
    await expectFail(setPaused(userA, true), "NotAdmin");

    await setPaused(admin, true);
    try {
      await expectFail(deposit(userA, 10 * UNIT), "VaultPaused");
      await expectFail(createCard(userC), "VaultPaused");
    } finally {
      await setPaused(admin, false);
    }

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.isFalse(vault.paused);
  });

  // ── week 10: withdraw ──────────────────────────────────────────────────────

  it("withdraw: A возвращает 50 shares → получает 50 токенов", async () => {
    const before = await bal(tokenAcc[key(userA)]);

    await withdraw(userA, 50 * UNIT);

    const after = await bal(tokenAcc[key(userA)]);
    assert.equal(after - before, BigInt(50 * UNIT));
    assert.equal(await bal(shareAcc[key(userA)]), BigInt(49 * UNIT));

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.totalTokens.toNumber(), 98_500_000);
    assert.equal(vault.totalShares.toNumber(), 98_500_000);

    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.deposited.toNumber(), 49 * UNIT);
    assert.equal(card.shares.toNumber(), 49 * UNIT);
  });

  it("withdraw: B выводит всё → shares сожжены, токены возвращены", async () => {
    await withdraw(userB, 49_500_000);

    assert.equal(await bal(shareAcc[key(userB)]), BigInt(0));
    // 1000 - 50 (депозит) + 49.5 (вывод); комиссия 0.5 не возвращается
    assert.equal(await bal(tokenAcc[key(userB)]), BigInt(999_500_000));

    const card = await program.account.userCard.fetch(cardPda(userB.publicKey));
    assert.equal(card.deposited.toNumber(), 0);
    assert.equal(card.shares.toNumber(), 0);

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.totalTokens.toNumber(), 49 * UNIT);
    assert.equal(vault.totalShares.toNumber(), 49 * UNIT);
  });

  it("withdraw: сумма 0 — ошибка", async () => {
    await expectFail(withdraw(userA, 0), "ZeroAmount");
  });

  it("withdraw: больше своих shares — ошибка", async () => {
    // у A осталось 49
    await expectFail(withdraw(userA, 60 * UNIT));
  });

  it("withdraw: без карточки — ошибка", async () => {
    await expectFail(withdraw(userC, 10 * UNIT), "AccountNotInitialized");
  });

  it("withdraw: работает даже на паузе", async () => {
    await setPaused(admin, true);
    try {
      const before = await bal(tokenAcc[key(userA)]);
      await withdraw(userA, 9 * UNIT);
      const after = await bal(tokenAcc[key(userA)]);
      assert.equal(after - before, BigInt(9 * UNIT));
    } finally {
      await setPaused(admin, false);
    }
  });

  // ── close_user_card ────────────────────────────────────────────────────────

  it("close_user_card: с shares — ошибка", async () => {
    await expectFail(closeCard(userA), "CardHasShares");
  });

  it("close_user_card: без shares — карточка закрыта", async () => {
    await closeCard(userB);
    const info = await provider.connection.getAccountInfo(cardPda(userB.publicKey));
    assert.isNull(info);
  });
});