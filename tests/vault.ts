import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SimpleVault } from "../target/types/simple_vault";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccountPda: anchor.web3.PublicKey;
  let shareMintPda: anchor.web3.PublicKey;

  const admin = provider.wallet;
  const userA = anchor.web3.Keypair.generate();
  const userB = anchor.web3.Keypair.generate();
  const userC = anchor.web3.Keypair.generate();
  const feeWallet = anchor.web3.Keypair.generate();

  let feeTokenAccount: anchor.web3.PublicKey;
  let userAUserCardPda: anchor.web3.PublicKey;
  let userBUserCardPda: anchor.web3.PublicKey;
  let userCUserCardPda: anchor.web3.PublicKey;

  let userATokenAccount: anchor.web3.PublicKey;
  let userBTokenAccount: anchor.web3.PublicKey;
  let userCTokenAccount: anchor.web3.PublicKey;

  let userAShareAccount: anchor.web3.PublicKey;
  let userBShareAccount: anchor.web3.PublicKey;
  let userCShareAccount: anchor.web3.PublicKey;

  before(async () => {
    // 1. Переводим SOL пользователям для оплаты транзакций
    for (const user of [userA, userB, userC]) {
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: user.publicKey,
          lamports: 0.005 * anchor.web3.LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    // 2. Создаем SPL токен
    tokenMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      6
    );

    // 3. Находим PDA адреса ваульта
    [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    [vaultTokenAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );

    [shareMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );

    // Карточки пользователей
    [userAUserCardPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userA.publicKey.toBuffer()],
      program.programId
    );

    [userBUserCardPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userB.publicKey.toBuffer()],
      program.programId
    );

    [userCUserCardPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userC.publicKey.toBuffer()],
      program.programId
    );

    // Токен-аккаунты
    const feeATA = await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, tokenMint, feeWallet.publicKey
    );
    feeTokenAccount = feeATA.address;

    const userAATA = await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, tokenMint, userA.publicKey
    );
    userATokenAccount = userAATA.address;

    const userBATA = await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, tokenMint, userB.publicKey
    );
    userBTokenAccount = userBATA.address;

    const userCATA = await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, tokenMint, userC.publicKey
    );
    userCTokenAccount = userCATA.address;
  });

  it("1. initialize_vault: создание ваульта", async () => {
    await program.methods
      .initializeVault(feeWallet.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccountPda,
        shareMint: shareMintPda,
        tokenMint: tokenMint,
        admin: admin.publicKey,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    assert.equal(vaultState.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vaultState.feeWallet.toBase58(), feeWallet.publicKey.toBase58());

    // Создаем share ATA для пользователей
    userAShareAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, shareMintPda, userA.publicKey
    )).address;

    userBShareAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, shareMintPda, userB.publicKey
    )).address;

    userCShareAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, (admin as any).payer, shareMintPda, userC.publicKey
    )).address;

    // Выдаем базовые токены пользователям
    await mintTo(provider.connection, (admin as any).payer, tokenMint, userATokenAccount, admin.publicKey, 2000);
    await mintTo(provider.connection, (admin as any).payer, tokenMint, userBTokenAccount, admin.publicKey, 2000);
    await mintTo(provider.connection, (admin as any).payer, tokenMint, userCTokenAccount, admin.publicKey, 2000);
  });

  it("2. toggle_pause: проверка паузы админом", async () => {
    await program.methods
      .togglePause()
      .accounts({ vaultState: vaultStatePda, admin: admin.publicKey })
      .rpc();

    let pausedState = await program.account.vaultState.fetch(vaultStatePda);
    assert.isTrue(pausedState.paused);

    // Снимаем паузу обратно
    await program.methods
      .togglePause()
      .accounts({ vaultState: vaultStatePda, admin: admin.publicKey })
      .rpc();

    pausedState = await program.account.vaultState.fetch(vaultStatePda);
    assert.isFalse(pausedState.paused);
  }, 60000);

  it("3. deposit: трое пользователей вносят разные суммы, проверяем доли по shares", async () => {
    // Пользователь A создает карточку и вносит 200 токенов (комиссия 2, депозит 198)
    await program.methods.createUserCard().accounts({
      vaultState: vaultStatePda, userCard: userAUserCardPda, user: userA.publicKey
    }).signers([userA]).rpc();

    await program.methods.deposit(new anchor.BN(200)).accounts({
      vaultState: vaultStatePda,
      userCard: userAUserCardPda,
      vaultTokenAccount: vaultTokenAccountPda,
      shareMint: shareMintPda,
      userTokenAccount: userATokenAccount,
      userShareAccount: userAShareAccount,
      feeTokenAccount: feeTokenAccount,
      user: userA.publicKey,
    }).signers([userA]).rpc();

    const cardA = await program.account.userCard.fetch(userAUserCardPda);
    assert.equal(cardA.shares.toString(), "198");

    // Пользователь B создает карточку и вносит 400 токенов (комиссия 4, депозит 396)
    await program.methods.createUserCard().accounts({
      vaultState: vaultStatePda, userCard: userBUserCardPda, user: userB.publicKey
    }).signers([userB]).rpc();

    await program.methods.deposit(new anchor.BN(400)).accounts({
      vaultState: vaultStatePda,
      userCard: userBUserCardPda,
      vaultTokenAccount: vaultTokenAccountPda,
      shareMint: shareMintPda,
      userTokenAccount: userBTokenAccount,
      userShareAccount: userBShareAccount,
      feeTokenAccount: feeTokenAccount,
      user: userB.publicKey,
    }).signers([userB]).rpc();

    const cardB = await program.account.userCard.fetch(userBUserCardPda);
    assert.equal(cardB.shares.toString(), "396");

    // Пользователь C создает карточку и вносит 1000 токенов (комиссия 10, депозит 990)
    await program.methods.createUserCard().accounts({
      vaultState: vaultStatePda, userCard: userCUserCardPda, user: userC.publicKey
    }).signers([userC]).rpc();

    await program.methods.deposit(new anchor.BN(1000)).accounts({
      vaultState: vaultStatePda,
      userCard: userCUserCardPda,
      vaultTokenAccount: vaultTokenAccountPda,
      shareMint: shareMintPda,
      userTokenAccount: userCTokenAccount,
      userShareAccount: userCShareAccount,
      feeTokenAccount: feeTokenAccount,
      user: userC.publicKey,
    }).signers([userC]).rpc();

    const cardC = await program.account.userCard.fetch(userCUserCardPda);
    assert.equal(cardC.shares.toString(), "990");

    // Проверяем общие начисления ваульта
    const vault = await program.account.vaultState.fetch(vaultStatePda);
    assert.equal(vault.totalTokens.toString(), "1584"); // 198 + 396 + 990
    assert.equal(vault.totalShares.toString(), "1584");
  });

  it("4. close_user_card: закрытие карточки с нулевым балансом", async () => {
    // Создаем временную карточку и сразу закрываем её
    const tempUser = anchor.web3.Keypair.generate();
    
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: tempUser.publicKey,
        lamports: 0.005 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);

    const [tempCardPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), tempUser.publicKey.toBuffer()],
      program.programId
    );

    await program.methods.createUserCard().accounts({
      vaultState: vaultStatePda, userCard: tempCardPda, user: tempUser.publicKey
    }).signers([tempUser]).rpc();

    await program.methods.closeUserCard().accounts({
      userCard: tempCardPda, owner: tempUser.publicKey
    }).signers([tempUser]).rpc();

    const closedInfo = await provider.connection.getAccountInfo(tempCardPda);
    assert.isNull(closedInfo);
  });
});