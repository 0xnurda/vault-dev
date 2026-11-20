/**
 * Недели 12–13: vault + Raydium CLMM на devnet
 *
 * Подготовка (каждый прогон — свои токены и свой пул):
 *   - admin создаёт TOKEN_A / TOKEN_B и CLMM-пул с ценой 1 (+ пустой пул A / C для проверки WrongPool)
 *   - admin своим кошельком кладёт ликвидность в пул A / B (иначе обменивать нечего)
 *   - vault для TOKEN_A, пользователь вносит 1000 TOKEN_A
 *
 * Неделя 12: add_pair_token, swap 300 A → B, пауза deposit/withdraw, отказы (не админ, slippage, чужой пул)
 * Неделя 13: позиция, комиссии, закрытие (рента возвращается админу), отказы
 * Финал: swap всего B → A + sync_vault одной транзакцией (даже если кто-то докинул B), вывод пользователя
 * Второй vault (на TOKEN_B): позиция без swap тоже ставит in_market; sync_vault с позицией → PositionOpen
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
  transfer,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  AccountMeta,
} from "@solana/web3.js";
import {
  Raydium,
  DEVNET_PROGRAM_ID,
  DEV_API_URLS,
  TxVersion,
  PoolUtils,
  TickUtils,
  PositionInfoLayout,
  getPdaTickArrayAddress,
  getPdaPersonalPositionAddress,
  getPdaExBitmapAccount,
} from "@raydium-io/raydium-sdk-v2";
import Decimal from "decimal.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

const CLMM = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const UNIT = 1_000_000; // decimals = 6
const TICK_SPACING = 60;
const U64_MAX = new BN("18446744073709551615"); // swap: «весь баланс»

/** Аккаунты одного vault, нужные Raydium-инструкциям */
interface VaultCtx {
  state: PublicKey;
  accA: PublicKey; // токен vault (token_mint)
  accB: PublicKey; // второй токен пары
  mintA: PublicKey;
  mintB: PublicKey;
}

/** Открытая позиция vault */
interface PositionCtx {
  nft: Keypair;
  tickLower: number;
  tickUpper: number;
}

describe("simple_vault + Raydium CLMM (недели 12–13)", () => {
  // commitment "confirmed": с "processed" (по умолчанию в Anchor) следующая транзакция
  // может попасть на ноду devnet, которая ещё не видит только что созданный аккаунт
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(new Connection(env.connection.rpcEndpoint, "confirmed"), env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const user = Keypair.generate();

  let raydium: Raydium;
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let tokenC: PublicKey;
  let poolId: PublicKey; // A / B, с ликвидностью
  let otherPoolId: PublicKey; // A / C, пустой — только для проверки WrongPool
  let walletPersonalPosition: PublicKey; // позиция кошелька admin в том же пуле (чужая для vault)

  let vault: VaultCtx; // основной vault на TOKEN_A
  let position: PositionCtx; // его позиция
  let shareMint: PublicKey;
  let userCard: PublicKey;
  let userTokenA: PublicKey;
  let userShares: PublicKey;

  // ─── helpers ───────────────────────────────────────────────────────────────

  const balance = async (acc: PublicKey) => (await getAccount(connection, acc)).amount;
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
  const exBitmap = () => getPdaExBitmapAccount(CLMM, poolId).publicKey;
  const writable = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
  const startIndex = (t: number) => TickUtils.getTickArrayStartIndexByTick(t, TICK_SPACING);
  const fetchVault = (state: PublicKey) => program.account.vaultState.fetch(state);
  const positionLiquidity = async (nft: PublicKey) => {
    const info = await connection.getAccountInfo(getPdaPersonalPositionAddress(CLMM, nft).publicKey);
    return PositionInfoLayout.decode(info!.data).liquidity as BN;
  };

  // Ждём, что вызов упадёт с конкретной ошибкой (по имени ошибки или по тексту в логах)
  const expectError = async (fn: () => Promise<unknown>, code: string) => {
    try {
      await fn();
    } catch (e: any) {
      const text = `${e?.error?.errorCode?.code ?? ""} ${e?.message ?? ""} ${(e?.logs ?? []).join(" ")}`;
      assert.include(text, code, `ожидали ошибку ${code}, получили: ${text.slice(0, 300)}`);
      return;
    }
    assert.fail(`ожидали ошибку ${code}, но вызов прошёл`);
  };

  const poolInfo = () => raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());

  // Свежий расчёт обмена: сколько выйдет и какие tick arrays нужны
  const quote = async (inputMint: PublicKey, amountIn: BN) => {
    const { poolInfo: info, poolKeys, computePoolInfo, tickData } = await poolInfo();
    const out = info.mintA.address === inputMint.toBase58() ? info.mintB : info.mintA;
    const res = PoolUtils.computeAmountOutFormat({
      poolInfo: computePoolInfo,
      tickArrayCache: tickData[poolId.toBase58()],
      amountIn,
      tokenOut: out,
      slippage: 0.05,
      epochInfo: await raydium.fetchEpochInfo(),
    } as any);
    return { info, poolKeys, computePoolInfo, res };
  };

  /**
   * Builder для vault::swap. `quoteAmount` — сколько реально уйдёт в обмен (для расчёта tick arrays),
   * нужен, когда amountIn = U64_MAX.
   */
  const vaultSwap = async (
    v: VaultCtx,
    amountIn: BN,
    minOut: BN,
    aToB: boolean,
    opts: { signer?: Keypair; pool?: PublicKey; swapPoolVaults?: boolean; quoteAmount?: BN } = {}
  ) => {
    const signer = opts.signer ?? admin;
    const input = aToB ? v.mintA : v.mintB;
    const output = aToB ? v.mintB : v.mintA;
    const { info, poolKeys, computePoolInfo, res } = await quote(input, opts.quoteAmount ?? amountIn);
    const poolVault = (mint: PublicKey) =>
      new PublicKey(info.mintA.address === mint.toBase58() ? poolKeys.vault.A : poolKeys.vault.B);
    let [inputVault, outputVault] = [poolVault(input), poolVault(output)];
    if (opts.swapPoolVaults) [inputVault, outputVault] = [outputVault, inputVault];

    return program.methods
      .swap(amountIn, minOut, aToB)
      .accounts({
        admin: signer.publicKey,
        vaultState: v.state,
        vaultTokenAccount: v.accA,
        vaultTokenAccountB: v.accB,
        ammConfig: new PublicKey(poolKeys.config.id),
        poolState: opts.pool ?? poolId,
        inputVault,
        outputVault,
        observationState: computePoolInfo.observationId,
        inputVaultMint: input,
        outputVaultMint: output,
        clmmProgram: CLMM,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
      } as any)
      .remainingAccounts([writable(exBitmap()), ...res.remainingAccounts.map(writable)])
      .preInstructions([cu])
      .signers(signer === admin ? [] : [signer]);
  };

  const syncVault = (v: VaultCtx, signer: Keypair = admin) =>
    program.methods
      .syncVault()
      .accounts({ admin: signer.publicKey, vaultState: v.state, vaultTokenAccount: v.accA, vaultTokenAccountB: v.accB } as any)
      .signers(signer === admin ? [] : [signer]);

  /** Builder для vault::open_position (суммы — в порядке токенов пула) */
  const openPosition = async (
    v: VaultCtx,
    p: PositionCtx,
    amount0: BN,
    amount1: BN,
    base0: boolean,
    opts: { signer?: Keypair; pool?: PublicKey } = {}
  ) => {
    const signer = opts.signer ?? admin;
    const { poolInfo: info, poolKeys } = await poolInfo();
    return program.methods
      .openPosition(p.tickLower, p.tickUpper, startIndex(p.tickLower), startIndex(p.tickUpper), amount0, amount1, base0)
      .accounts({
        admin: signer.publicKey,
        vaultState: v.state,
        vaultTokenAccount: v.accA,
        vaultTokenAccountB: v.accB,
        poolState: opts.pool ?? poolId,
        positionNftMint: p.nft.publicKey,
        positionNftAccount: getAssociatedTokenAddressSync(p.nft.publicKey, v.state, true, TOKEN_2022_PROGRAM_ID),
        personalPosition: getPdaPersonalPositionAddress(CLMM, p.nft.publicKey).publicKey,
        tickArrayLower: getPdaTickArrayAddress(CLMM, poolId, startIndex(p.tickLower)).publicKey,
        tickArrayUpper: getPdaTickArrayAddress(CLMM, poolId, startIndex(p.tickUpper)).publicKey,
        tokenVault0: new PublicKey(poolKeys.vault.A),
        tokenVault1: new PublicKey(poolKeys.vault.B),
        vault0Mint: new PublicKey(info.mintA.address),
        vault1Mint: new PublicKey(info.mintB.address),
        clmmProgram: CLMM,
      } as any)
      .remainingAccounts([writable(exBitmap())])
      .preInstructions([cu])
      .signers(signer === admin ? [p.nft] : [signer, p.nft]);
  };

  /** Аккаунты позиции vault для collect_fees / close_position */
  const positionAccounts = async (
    v: VaultCtx,
    p: PositionCtx,
    opts: { signer?: Keypair; personalPosition?: PublicKey } = {}
  ) => {
    const { poolKeys } = await poolInfo();
    return {
      admin: (opts.signer ?? admin).publicKey,
      vaultState: v.state,
      vaultTokenAccount: v.accA,
      vaultTokenAccountB: v.accB,
      poolState: poolId,
      positionNftMint: p.nft.publicKey,
      positionNftAccount: getAssociatedTokenAddressSync(p.nft.publicKey, v.state, true, TOKEN_2022_PROGRAM_ID),
      personalPosition: opts.personalPosition ?? getPdaPersonalPositionAddress(CLMM, p.nft.publicKey).publicKey,
      tokenVault0: new PublicKey(poolKeys.vault.A),
      tokenVault1: new PublicKey(poolKeys.vault.B),
      tickArrayLower: getPdaTickArrayAddress(CLMM, poolId, startIndex(p.tickLower)).publicKey,
      tickArrayUpper: getPdaTickArrayAddress(CLMM, poolId, startIndex(p.tickUpper)).publicKey,
      vault0Mint: new PublicKey(poolKeys.mintA.address),
      vault1Mint: new PublicKey(poolKeys.mintB.address),
      clmmProgram: CLMM,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  };

  const collectFees = async (v: VaultCtx, p: PositionCtx, opts: { signer?: Keypair; personalPosition?: PublicKey } = {}) =>
    program.methods
      .collectFees()
      .accounts((await positionAccounts(v, p, opts)) as any)
      .remainingAccounts([writable(exBitmap())])
      .preInstructions([cu])
      .signers(opts.signer ? [opts.signer] : []);

  const closePosition = async (v: VaultCtx, p: PositionCtx, opts: { signer?: Keypair } = {}) =>
    program.methods
      .closePosition(new BN(0), new BN(0))
      .accounts((await positionAccounts(v, p, opts)) as any)
      .remainingAccounts([writable(exBitmap())])
      .preInstructions([cu])
      .signers(opts.signer ? [opts.signer] : []);

  // Обмен кошельком admin (не vault) — чтобы в пуле шла торговля и капали комиссии
  const walletSwap = async (inputMint: PublicKey, amountIn: BN) => {
    const { info, poolKeys, computePoolInfo, res } = await quote(inputMint, amountIn);
    const { execute } = await raydium.clmm.swap({
      poolInfo: info,
      poolKeys,
      inputMint,
      amountIn,
      amountOutMin: res.minAmountOut.amount.raw,
      observationId: computePoolInfo.observationId,
      ownerInfo: { useSOLBalance: false },
      remainingAccounts: res.remainingAccounts,
      txVersion: TxVersion.V0,
    });
    await execute({ sendAndConfirm: true });
  };

  const vaultPdas = (mintA: PublicKey, mintB: PublicKey): VaultCtx => ({
    state: PublicKey.findProgramAddressSync([Buffer.from("vault"), mintA.toBuffer()], program.programId)[0],
    accA: PublicKey.findProgramAddressSync([Buffer.from("vault_tokens"), mintA.toBuffer()], program.programId)[0],
    accB: PublicKey.findProgramAddressSync([Buffer.from("vault_tokens_b"), mintA.toBuffer()], program.programId)[0],
    mintA,
    mintB,
  });
  const shareMintOf = (mintA: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("share_mint"), mintA.toBuffer()], program.programId)[0];

  const initVault = (v: VaultCtx) =>
    program.methods
      .initializeVault()
      .accounts({ vaultState: v.state, vaultTokenAccount: v.accA, shareMint: shareMintOf(v.mintA), tokenMint: v.mintA, admin: admin.publicKey } as any)
      .rpc();

  const addPairToken = (v: VaultCtx, signer: Keypair = admin) =>
    program.methods
      .addPairToken()
      .accounts({ vaultState: v.state, tokenMintB: v.mintB, vaultTokenAccountB: v.accB, admin: signer.publicKey } as any)
      .signers(signer === admin ? [] : [signer])
      .rpc();

  const depositOrWithdraw = (method: "deposit" | "withdraw", amount: number) =>
    (program.methods as any)
      [method](new BN(amount))
      .accounts({
        vaultState: vault.state,
        userCard,
        vaultTokenAccount: vault.accA,
        shareMint,
        userTokenAccount: userTokenA,
        userShareAccount: userShares,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

  const adminAta = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, admin.publicKey);

  // ─── подготовка ────────────────────────────────────────────────────────────

  before(async () => {
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: user.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })
      ),
      [admin]
    );

    // 1. Свои токены
    tokenA = await createMint(connection, admin, admin.publicKey, null, 6);
    tokenB = await createMint(connection, admin, admin.publicKey, null, 6);
    tokenC = await createMint(connection, admin, admin.publicKey, null, 6);
    for (const mint of [tokenA, tokenB]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey);
      await mintTo(connection, admin, mint, ata.address, admin, 1_000_000 * UNIT);
    }

    // 2. CLMM-пулы с ценой 1: A / B (рабочий) и A / C (пустой, для WrongPool)
    raydium = await Raydium.load({
      owner: admin,
      connection,
      cluster: "devnet",
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: "finalized",
      urlConfigs: DEV_API_URLS,
    });
    const configs = await raydium.api.getClmmConfigs();
    const config = configs.find((c) => c.tickSpacing === TICK_SPACING)!;
    const token = (mint: PublicKey) =>
      ({ address: mint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 6 } as any);
    const createPool = async (m1: PublicKey, m2: PublicKey) => {
      const created = await raydium.clmm.createPool({
        programId: CLMM,
        mint1: token(m1),
        mint2: token(m2),
        ammConfig: { ...config, id: new PublicKey(config.id), fundOwner: "", description: "" } as any,
        initialPrice: new Decimal(1),
        txVersion: TxVersion.V0,
      });
      await created.execute({ sendAndConfirm: true });
      return new PublicKey(String((created.extInfo as any).address.id));
    };
    poolId = await createPool(tokenA, tokenB);
    otherPoolId = await createPool(tokenA, tokenC);
    console.log("  Pool A/B:", poolId.toBase58());

    // 3. Ликвидность от кошелька admin: 10 000 каждого токена в диапазоне цен 0.5–2
    const { poolInfo: info, poolKeys } = await poolInfo();
    const tickAt = (price: number) => TickUtils.getPriceAndTick({ poolInfo: info, price: new Decimal(price), baseIn: true }).tick;
    const lp = await raydium.clmm.openPositionFromBase({
      poolInfo: info,
      poolKeys,
      tickLower: tickAt(0.5),
      tickUpper: tickAt(2),
      base: "MintA",
      baseAmount: new BN(10_000 * UNIT),
      otherAmountMax: new BN(20_000 * UNIT),
      ownerInfo: { useSOLBalance: false },
      nft2022: true,
      txVersion: TxVersion.V0,
    } as any);
    await lp.execute({ sendAndConfirm: true });
    walletPersonalPosition = lp.extInfo.personalPosition;

    // 4. Vault для TOKEN_A, пользователь с карточкой вносит 1000 TOKEN_A
    vault = vaultPdas(tokenA, tokenB);
    shareMint = shareMintOf(tokenA);
    [userCard] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vault.state.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
    await initVault(vault);
    await program.methods
      .createUserCard()
      .accounts({ vaultState: vault.state, userCard, user: user.publicKey } as any)
      .signers([user])
      .rpc();

    userTokenA = await createAccount(connection, admin, tokenA, user.publicKey);
    userShares = await createAccount(connection, admin, shareMint, user.publicKey);
    await mintTo(connection, admin, tokenA, userTokenA, admin, 1000 * UNIT);
    await depositOrWithdraw("deposit", 1000 * UNIT);
  });

  // ─── add_pair_token ────────────────────────────────────────────────────────

  it("add_pair_token: не админ — ошибка", async () => {
    await expectError(() => addPairToken(vault, user), "Unauthorized");
  });

  it("add_pair_token: vault получает аккаунт для TOKEN_B", async () => {
    await addPairToken(vault);

    const state = await fetchVault(vault.state);
    assert.equal(state.tokenMintB.toBase58(), tokenB.toBase58());
    assert.equal(state.vaultTokenAccountB.toBase58(), vault.accB.toBase58());
    assert.equal(await balance(vault.accB), BigInt(0));
  });

  // ─── неделя 12: swap ───────────────────────────────────────────────────────

  it("swap: не админ — ошибка", async () => {
    await expectError(async () => (await vaultSwap(vault, new BN(10 * UNIT), new BN(0), true, { signer: user })).rpc(), "Unauthorized");
  });

  it("swap: пул другой пары (A / C) — ошибка WrongPool", async () => {
    await expectError(async () => (await vaultSwap(vault, new BN(10 * UNIT), new BN(0), true, { pool: otherPoolId })).rpc(), "WrongPool");
  });

  it("swap: хранилища пула перепутаны местами — ошибка WrongPool", async () => {
    await expectError(
      async () => (await vaultSwap(vault, new BN(10 * UNIT), new BN(0), true, { swapPoolVaults: true })).rpc(),
      "WrongPool"
    );
  });

  it("swap: min_amount_out выше реального выхода — откат", async () => {
    // 10 A по цене ~1 дают чуть меньше 10 B (комиссия 0.25%) — просим ровно 10 B
    await expectError(async () => (await vaultSwap(vault, new BN(10 * UNIT), new BN(10 * UNIT), true)).rpc(), "TooLittleOutputReceived");
    assert.equal(await balance(vault.accA), BigInt(1000 * UNIT));
    assert.isFalse((await fetchVault(vault.state)).inMarket);
  });

  it("swap: vault меняет 300 A → B через пул", async () => {
    const { res } = await quote(tokenA, new BN(300 * UNIT));
    await (await vaultSwap(vault, new BN(300 * UNIT), res.minAmountOut.amount.raw, true)).rpc();

    assert.equal(await balance(vault.accA), BigInt(700 * UNIT));
    const b = await balance(vault.accB);
    assert.isTrue(b > BigInt(290 * UNIT) && b < BigInt(300 * UNIT), `B после обмена: ${b}`);

    const state = await fetchVault(vault.state);
    assert.isTrue(state.inMarket);
    assert.equal(state.totalTokens.toNumber(), 1000 * UNIT); // учёт заморожен до sync_vault
  });

  it("deposit и withdraw на паузе, пока деньги в рынке", async () => {
    await mintTo(connection, admin, tokenA, userTokenA, admin, 1 * UNIT);
    await expectError(() => depositOrWithdraw("deposit", 1 * UNIT), "InMarket");
    await expectError(() => depositOrWithdraw("withdraw", 1 * UNIT), "InMarket");
  });

  it("sync_vault: есть TOKEN_B — ошибка TokenBNotZero", async () => {
    await expectError(() => syncVault(vault).rpc(), "TokenBNotZero");
  });

  it("sync_vault: не админ — ошибка", async () => {
    await expectError(() => syncVault(vault, user).rpc(), "Unauthorized");
  });

  // ─── неделя 13: позиция ────────────────────────────────────────────────────

  it("open_position: не админ — ошибка", async () => {
    const p = { nft: Keypair.generate(), tickLower: -1200, tickUpper: 1200 };
    await expectError(async () => (await openPosition(vault, p, new BN(UNIT), new BN(UNIT), true, { signer: user })).rpc(), "Unauthorized");
  });

  it("open_position: пул другой пары — ошибка WrongPool", async () => {
    const p = { nft: Keypair.generate(), tickLower: -1200, tickUpper: 1200 };
    await expectError(async () => (await openPosition(vault, p, new BN(UNIT), new BN(UNIT), true, { pool: otherPoolId })).rpc(), "WrongPool");
  });

  it("open_position: vault кладёт A и B в диапазон 0.8–1.25", async () => {
    const { poolInfo: info } = await poolInfo();
    const tickAt = (price: number) => TickUtils.getPriceAndTick({ poolInfo: info, price: new Decimal(price), baseIn: true }).tick;
    position = { nft: Keypair.generate(), tickLower: tickAt(0.8), tickUpper: tickAt(1.25) };

    const aBefore = await balance(vault.accA);
    const bBefore = await balance(vault.accB);
    const aIsToken0 = info.mintA.address === tokenA.toBase58();
    // base = token_0, кладём 200; второго токена — сколько потребуется, но не больше, чем есть у vault
    const amount1Max = new BN((aIsToken0 ? bBefore : aBefore).toString());
    await (await openPosition(vault, position, new BN(200 * UNIT), amount1Max, true)).rpc();

    const aAfter = await balance(vault.accA);
    const bAfter = await balance(vault.accB);
    const [spent0, spent1] = aIsToken0 ? [aBefore - aAfter, bBefore - bAfter] : [bBefore - bAfter, aBefore - aAfter];
    assert.isTrue(spent0 > BigInt(0) && spent0 <= BigInt(200 * UNIT), `token_0 потрачено: ${spent0}`);
    assert.isTrue(spent1 > BigInt(0), `token_1 потрачено: ${spent1}`);

    const state = await fetchVault(vault.state);
    assert.equal(state.positionNftMint.toBase58(), position.nft.publicKey.toBase58());

    // NFT позиции принадлежит vault PDA, а разрешение админу снято
    const nftAcc = await getAccount(
      connection,
      getAssociatedTokenAddressSync(position.nft.publicKey, vault.state, true, TOKEN_2022_PROGRAM_ID),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(nftAcc.amount, BigInt(1));
    assert.equal(nftAcc.owner.toBase58(), vault.state.toBase58());
    for (const acc of [vault.accA, vault.accB]) {
      assert.isNull((await getAccount(connection, acc)).delegate, "delegate должен быть снят");
    }
  });

  it("open_position: вторая позиция — ошибка", async () => {
    const p = { ...position, nft: Keypair.generate() };
    await expectError(async () => (await openPosition(vault, p, new BN(UNIT), new BN(UNIT), true)).rpc(), "PositionAlreadyOpen");
  });

  it("collect_fees / close_position: не админ — ошибка", async () => {
    await expectError(async () => (await collectFees(vault, position, { signer: user })).rpc(), "Unauthorized");
    await expectError(async () => (await closePosition(vault, position, { signer: user })).rpc(), "Unauthorized");
  });

  it("collect_fees: чужая позиция в том же пуле — ошибка NoOpenPosition", async () => {
    await expectError(
      async () => (await collectFees(vault, position, { personalPosition: walletPersonalPosition })).rpc(),
      "NoOpenPosition"
    );
  });

  it("collect_fees: после торговли в пуле vault забирает только комиссии", async () => {
    // Кошелёк гоняет обмены туда-обратно — позиция vault в диапазоне и получает долю комиссий
    await walletSwap(tokenA, new BN(1000 * UNIT));
    await walletSwap(tokenB, new BN(1000 * UNIT));

    const aBefore = await balance(vault.accA);
    const bBefore = await balance(vault.accB);
    const liquidityBefore = await positionLiquidity(position.nft.publicKey);
    assert.isTrue(liquidityBefore.gtn(0));

    await (await collectFees(vault, position)).rpc();

    const gainA = (await balance(vault.accA)) - aBefore;
    const gainB = (await balance(vault.accB)) - bBefore;
    console.log(`  Комиссии: A +${gainA}, B +${gainB} (в минимальных единицах)`);
    // Обмены были в обе стороны — комиссии пришли в обоих токенах, и это именно комиссии (< 10 токенов),
    // а не выведенная ликвидность (в позиции ~200 токенов каждого)
    assert.isTrue(gainA > BigInt(0) && gainA < BigInt(10 * UNIT), `комиссия в TOKEN_A: ${gainA}`);
    assert.isTrue(gainB > BigInt(0) && gainB < BigInt(10 * UNIT), `комиссия в TOKEN_B: ${gainB}`);

    // Ликвидность позиции не тронута
    assert.equal((await positionLiquidity(position.nft.publicKey)).toString(), liquidityBefore.toString());
    assert.equal((await fetchVault(vault.state)).positionNftMint.toBase58(), position.nft.publicKey.toBase58());
  });

  it("close_position: ликвидность возвращается в vault, рента — админу", async () => {
    const aBefore = await balance(vault.accA);
    const bBefore = await balance(vault.accB);

    await (await closePosition(vault, position)).rpc();

    assert.isTrue((await balance(vault.accA)) > aBefore, "TOKEN_A вернулся");
    assert.isTrue((await balance(vault.accB)) > bBefore, "TOKEN_B вернулся");
    assert.isNull(await connection.getAccountInfo(getPdaPersonalPositionAddress(CLMM, position.nft.publicKey).publicKey));

    // На vault PDA не осталось лишних лампортов: рента позиции ушла админу
    const vaultInfo = await connection.getAccountInfo(vault.state);
    const minBalance = await connection.getMinimumBalanceForRentExemption(vaultInfo!.data.length);
    assert.equal(vaultInfo!.lamports, minBalance);

    const state = await fetchVault(vault.state);
    assert.equal(state.positionNftMint.toBase58(), PublicKey.default.toBase58());
    assert.isTrue(state.inMarket, "пока есть TOKEN_B, vault всё ещё в рынке");
  });

  // ─── финал: всё обратно в A ────────────────────────────────────────────────

  it("swap всего B → A + sync_vault одной транзакцией, даже если кто-то докинул B", async () => {
    // Кто-то переводит vault 1 единицу TOKEN_B прямо перед обменом админа
    await transfer(connection, admin, adminAta(tokenB), vault.accB, admin, 1);
    const allB = new BN((await balance(vault.accB)).toString());

    const { res } = await quote(tokenB, allB);
    const syncIx = await syncVault(vault).instruction();
    // amount_in = U64_MAX: контракт сам берёт весь баланс B на момент выполнения
    await (await vaultSwap(vault, U64_MAX, res.minAmountOut.amount.raw, false, { quoteAmount: allB }))
      .postInstructions([syncIx])
      .rpc();

    assert.equal(await balance(vault.accB), BigInt(0));
    const state = await fetchVault(vault.state);
    const realA = await balance(vault.accA);
    assert.isFalse(state.inMarket);
    assert.equal(state.totalTokens.toString(), realA.toString());
    assert.notEqual(state.totalTokens.toNumber(), 1000 * UNIT, "после обменов и комиссий сумма должна измениться");
    console.log(`  total_tokens: 1000 → ${Number(realA) / UNIT}`);
  });

  it("withdraw: пользователь выводит все shares и получает весь TOKEN_A vault", async () => {
    const before = await balance(userTokenA);
    const vaultA = await balance(vault.accA);

    await depositOrWithdraw("withdraw", 1000 * UNIT);

    assert.equal((await balance(userTokenA)) - before, vaultA);
    assert.equal(await balance(userShares), BigInt(0));
    assert.equal(await balance(vault.accA), BigInt(0));
  });

  it("swap B → A тоже переводит vault в рынок", async () => {
    await transfer(connection, admin, adminAta(tokenB), vault.accB, admin, 10 * UNIT);
    const { res } = await quote(tokenB, new BN(10 * UNIT));
    assert.isFalse((await fetchVault(vault.state)).inMarket);

    await (await vaultSwap(vault, U64_MAX, res.minAmountOut.amount.raw, false, { quoteAmount: new BN(10 * UNIT) })).rpc();
    assert.isTrue((await fetchVault(vault.state)).inMarket);

    await syncVault(vault).rpc();
    assert.isFalse((await fetchVault(vault.state)).inMarket);
  });

  // ─── второй vault: позиция без предварительного swap ───────────────────────

  describe("второй vault (на TOKEN_B, пара — TOKEN_A)", () => {
    let vault2: VaultCtx;
    let position2: PositionCtx;

    before(async () => {
      vault2 = vaultPdas(tokenB, tokenA);
      await initVault(vault2);
      await addPairToken(vault2);
      // Кладём в vault2 50 TOKEN_B напрямую (для проверки позиции депозиты не нужны)
      await transfer(connection, admin, adminAta(tokenB), vault2.accA, admin, 50 * UNIT);
    });

    it("open_position без swap ставит in_market (позиция только из своего токена, вне цены)", async () => {
      const { poolInfo: info, computePoolInfo } = await poolInfo();
      const bIsToken0 = info.mintA.address === tokenB.toBase58();
      const current = Math.floor(computePoolInfo.tickCurrent / TICK_SPACING) * TICK_SPACING;
      // Диапазон, где нужен только token_0 — выше текущей цены; только token_1 — ниже
      const [tickLower, tickUpper] = bIsToken0 ? [current + 600, current + 1200] : [current - 1200, current - 600];
      position2 = { nft: Keypair.generate(), tickLower, tickUpper };
      const amount = new BN(50 * UNIT);

      assert.isFalse((await fetchVault(vault2.state)).inMarket);
      await (await openPosition(vault2, position2, bIsToken0 ? amount : new BN(0), bIsToken0 ? new BN(0) : amount, bIsToken0)).rpc();

      const state = await fetchVault(vault2.state);
      assert.isTrue(state.inMarket, "открытая позиция должна ставить in_market даже без swap");
      assert.equal(await balance(vault2.accB), BigInt(0), "второй токен vault2 не тратился");
    });

    it("sync_vault: TOKEN_B = 0, но позиция открыта — ошибка PositionOpen", async () => {
      await expectError(() => syncVault(vault2).rpc(), "PositionOpen");
    });

    it("close_position + sync_vault: vault2 снова в обычном режиме", async () => {
      await (await closePosition(vault2, position2)).rpc();
      await syncVault(vault2).rpc();

      const state = await fetchVault(vault2.state);
      assert.isFalse(state.inMarket);
      assert.equal(state.totalTokens.toString(), (await balance(vault2.accA)).toString());
    });
  });
});
