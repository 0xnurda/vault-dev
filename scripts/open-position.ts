/**
 * Открыть позицию в Raydium CLMM через наш vault smart contract.
 *
 * Поток:
 *   Script → vault::open_raydium_position (CPI) → Raydium CLMM devnet
 *
 * Требования перед запуском:
 *   1. Vault инициализирован (initialize_vault)
 *   2. vault_wsol_account создан и пополнен wSOL
 *   3. vault_token_account пополнен MyToken
 *   4. Достаточно SOL на кошельке для rent (position NFT, tick arrays)
 *
 * Запуск:
 *   npx ts-node scripts/open-position.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  Raydium,
  TickUtils,
  PoolUtils,
  getPdaTickArrayAddress,
  TxVersion,
  DEV_API_URLS,
} from "@raydium-io/raydium-sdk-v2";
import Decimal from "decimal.js";
import * as fs from "fs";
import * as path from "path";
import { SimpleVault } from "../target/types/simple_vault";

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация
// ─────────────────────────────────────────────────────────────────────────────

const POOL_ID = new PublicKey("7ZVMVG2fa1chZVqGDuiofgqq6R5puZJJNGgjFd4EkXpu");
const MY_TOKEN_MINT = new PublicKey("4T9jq581kFSNE4aAtgzsAAVAy6Cfvq9M4dkBtahD4JSa");
const WSOL_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112
const RAYDIUM_CLMM_DEVNET = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");

// Сколько вносим в позицию
const SOL_AMOUNT_LAMPORTS  = 0.05 * 1e9;  // 0.05 SOL
const TOKEN_AMOUNT_RAW     = 10 * 1e6;    // 10 MyToken (6 decimals)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadWallet(): Keypair {
  const keyPath = path.join(process.env.HOME!, ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function createOrFundWsolAccount(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  lamports: number
): Promise<PublicKey> {
  const wsolAta = await getAssociatedTokenAddress(WSOL_MINT, owner, true);
  const accountInfo = await connection.getAccountInfo(wsolAta);

  const tx = new Transaction();
  if (!accountInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        owner,
        WSOL_MINT
      )
    );
  }
  // Переводим SOL → wSOL (wrap)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports,
    }),
    createSyncNativeInstruction(wsolAta)
  );

  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`  wSOL account funded: ${wsolAta.toBase58()}`);
  return wsolAta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = loadWallet();
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(await connection.getBalance(wallet.publicKey)) / 1e9} SOL`);

  // ─── Anchor provider ──────────────────────────────────────────────────────
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../target/idl/simple_vault.json"),
      "utf-8"
    )
  );
  const program = new Program(idl, provider) as Program<SimpleVault>;

  // ─── Raydium SDK (devnet) ────────────────────────────────────────────────
  console.log("\n=== Инициализация Raydium SDK ===");
  const raydium = await Raydium.load({
    owner: wallet,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
    urlConfigs: DEV_API_URLS,
  });

  // ─── Получаем информацию о пуле ──────────────────────────────────────────
  console.log(`\nЗагружаем pool info: ${POOL_ID.toBase58()}`);
  const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(
    POOL_ID.toBase58()
  );
  console.log(`  token0 (mintA): ${poolInfo.mintA.address}`);
  console.log(`  token1 (mintB): ${poolInfo.mintB.address}`);
  console.log(`  tickSpacing:    ${poolInfo.config.tickSpacing}`);
  console.log(`  currentPrice:   ${poolInfo.price}`);

  // ─── Вычисляем tick range от текущего тика пула ──────────────────────────
  const tickSpacing = poolInfo.config.tickSpacing;
  const currentTick: number = (poolInfo as any).tickCurrent ?? (poolInfo as any).config?.tickCurrent ?? 0;
  console.log(`  currentTick:    ${currentTick}`);

  // Диапазон ±5000 тиков (~±5% для большинства пулов)
  const TICK_RANGE = 5000;
  const tickLower = Math.floor((currentTick - TICK_RANGE) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + TICK_RANGE) / tickSpacing) * tickSpacing;
  const tickArrayLowerStart = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
  const tickArrayUpperStart = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

  console.log(`\n  Tick range: ${tickLower} → ${tickUpper}`);
  console.log(`  TickArray lower start: ${tickArrayLowerStart}`);
  console.log(`  TickArray upper start: ${tickArrayUpperStart}`);

  // ─── Рассчитываем ликвидность ─────────────────────────────────────────────
  const myTokenIsA = poolInfo.mintA.address === MY_TOKEN_MINT.toBase58();
  const baseAmount = myTokenIsA ? TOKEN_AMOUNT_RAW : SOL_AMOUNT_LAMPORTS;

  const epochInfo = await connection.getEpochInfo();

  const { liquidity, amountSlippageA, amountSlippageB } =
    await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      slippage: 0.01,
      inputA: myTokenIsA,
      tickUpper: Math.max(tickLower, tickUpper),
      tickLower: Math.min(tickLower, tickUpper),
      amount: new BN(baseAmount),
      add: true,
      epochInfo,
      amountHasFee: false,
    });

  const amount0Max = amountSlippageA.amount.toNumber();
  const amount1Max = amountSlippageB.amount.toNumber();
  console.log(`\n  Ликвидность:  ${liquidity.toString()}`);
  console.log(`  amount0Max:   ${amount0Max}`);
  console.log(`  amount1Max:   ${amount1Max}`);

  // ─── PDA адреса нашего vault ──────────────────────────────────────────────
  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), MY_TOKEN_MINT.toBuffer()],
    program.programId
  );
  const [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tokens"), MY_TOKEN_MINT.toBuffer()],
    program.programId
  );
  const [shareMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), MY_TOKEN_MINT.toBuffer()],
    program.programId
  );

  console.log(`\n  Vault PDA:         ${vaultStatePDA.toBase58()}`);
  console.log(`  Vault token acct:  ${vaultTokenAccountPDA.toBase58()}`);

  // ─── Инициализировать vault если ещё не создан ───────────────────────────
  const vaultAccountInfo = await connection.getAccountInfo(vaultStatePDA);
  if (!vaultAccountInfo) {
    console.log("\n=== Инициализация vault ===");
    const txInit = await program.methods
      .initializeVault()
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint: MY_TOKEN_MINT,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([wallet])
      .rpc({ commitment: "confirmed" });
    console.log(`  ✓ Vault создан: ${txInit}`);
  } else {
    console.log("\n  Vault уже инициализирован.");
  }

  // ─── Пополнить vault_token_account MyToken с кошелька ───────────────────
  const vaultTokenBalance = await connection.getTokenAccountBalance(vaultTokenAccountPDA).catch(() => null);
  const vaultTokenAmount = vaultTokenBalance ? Number(vaultTokenBalance.value.amount) : 0;
  if (vaultTokenAmount < TOKEN_AMOUNT_RAW) {
    console.log(`\n  Переводим MyToken кошелёк → vault_token_account...`);
    const { transfer, getAssociatedTokenAddress: getAta } = await import("@solana/spl-token");
    const walletTokenAta = await getAta(MY_TOKEN_MINT, wallet.publicKey);
    await transfer(
      connection,
      wallet,
      walletTokenAta,        // откуда (кошелёк)
      vaultTokenAccountPDA,  // куда (vault PDA token account)
      wallet.publicKey,      // authority
      TOKEN_AMOUNT_RAW * 2
    );
    console.log(`  ✓ Переведено ${TOKEN_AMOUNT_RAW * 2 / 1e6} MyToken в vault`);
  } else {
    console.log(`\n  Vault уже имеет ${vaultTokenAmount / 1e6} MyToken`);
  }

  // ─── Создаём / пополняем vault wSOL account ──────────────────────────────
  console.log("\n=== Подготовка vault wSOL account ===");
  const vaultWsolAccount = await createOrFundWsolAccount(
    connection,
    wallet,
    vaultStatePDA,   // owner = vault PDA
    SOL_AMOUNT_LAMPORTS + 10_000_000 // +0.01 SOL буфер для rent/fees
  );

  // ─── Получаем Raydium аккаунты из poolKeys ───────────────────────────────
  const poolState  = new PublicKey(poolKeys.id);
  const tokenVault0 = new PublicKey(poolKeys.vault.A);
  const tokenVault1 = new PublicKey(poolKeys.vault.B);
  const vault0Mint  = new PublicKey(poolInfo.mintA.address);
  const vault1Mint  = new PublicKey(poolInfo.mintB.address);

  // TickArray PDAs — используем SDK для правильного derivation
  const tickArrayLower = getPdaTickArrayAddress(RAYDIUM_CLMM_DEVNET, poolState, tickArrayLowerStart).publicKey;
  const tickArrayUpper = getPdaTickArrayAddress(RAYDIUM_CLMM_DEVNET, poolState, tickArrayUpperStart).publicKey;
  console.log(`  TickArray lower PDA: ${tickArrayLower.toBase58()}`);
  console.log(`  TickArray upper PDA: ${tickArrayUpper.toBase58()}`);

  // Position NFT mint (новый keypair)
  const positionNftMint = Keypair.generate();
  console.log(`\n  Position NFT mint: ${positionNftMint.publicKey.toBase58()}`);

  // Position NFT account (ATA для vault PDA)
  const positionNftAccount = await getAssociatedTokenAddress(
    positionNftMint.publicKey,
    vaultStatePDA,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Personal position PDA
  const [personalPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionNftMint.publicKey.toBuffer()],
    RAYDIUM_CLMM_DEVNET
  );

  // Tick array bitmap extension
  const [tickArrayBitmap] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
    RAYDIUM_CLMM_DEVNET
  );

  // ─── Вызываем наш vault → CPI в Raydium ──────────────────────────────────
  console.log("\n=== Вызов vault::open_raydium_position ===");

  const tx = await program.methods
    .openRaydiumPosition(
      tickLower,
      tickUpper,
      tickArrayLowerStart,
      tickArrayUpperStart,
      new BN(liquidity.toString()),
      new BN(amount0Max),
      new BN(amount1Max)
    )
    .accountsPartial({
      admin:               wallet.publicKey,
      vaultState:          vaultStatePDA,
      vaultTokenAccount:   vaultTokenAccountPDA,
      vaultWsolAccount:    vaultWsolAccount,
      wsolMint:            WSOL_MINT,
      poolState:           poolState,
      positionNftMint:     positionNftMint.publicKey,
      positionNftAccount:  positionNftAccount,
      personalPosition:    personalPosition,
      tickArrayLower:      tickArrayLower,
      tickArrayUpper:      tickArrayUpper,
      tokenVault0:         tokenVault0,
      tokenVault1:         tokenVault1,
      vault0Mint:          vault0Mint,
      vault1Mint:          vault1Mint,
      tickArrayBitmap:     tickArrayBitmap,
      clmmProgram:         RAYDIUM_CLMM_DEVNET,
      rent:                SYSVAR_RENT_PUBKEY,
      systemProgram:       SystemProgram.programId,
      tokenProgram:        TOKEN_PROGRAM_ID,
      tokenProgram2022:    TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([wallet, positionNftMint])
    .rpc({ commitment: "confirmed" });

  console.log(`\n✅ Позиция открыта!`);
  console.log(`   TX: ${tx}`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

main().catch((err) => {
  console.error("\n❌ Ошибка:", err);
  if (err.logs) {
    console.error("\nProgram logs:");
    err.logs.forEach((l: string) => console.error(" ", l));
  }
  process.exit(1);
});
