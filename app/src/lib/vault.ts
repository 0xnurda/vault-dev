// Всё общение с контрактом: адреса PDA, чтение состояния и три действия пользователя.
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../idl/simple_vault.json";
import type { SimpleVault } from "../idl/simple_vault";
import { PROGRAM_ID, RPC_URL, TOKEN_MINT } from "../config";
import type { BrowserWallet } from "./wallet";
import { tokenBalance } from "./balance";

export const connection = new Connection(RPC_URL, "confirmed");

const toBig = (bn: BN) => BigInt(bn.toString());
const toBN = (n: bigint) => new BN(n.toString());

// Те же seeds, что в lib.rs
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const vaultPdaFor = (mint: PublicKey) => pda(Buffer.from("vault"), mint.toBuffer());
export const cardPdaFor = (vault: PublicKey, user: PublicKey) =>
  pda(Buffer.from("user_card"), vault.toBuffer(), user.toBuffer());

export const vaultPda = vaultPdaFor(TOKEN_MINT);
export const vaultTokensPda = pda(Buffer.from("vault_tokens"), TOKEN_MINT.toBuffer());
export const shareMintPda = pda(Buffer.from("share_mint"), TOKEN_MINT.toBuffer());
export const cardPda = (user: PublicKey) => cardPdaFor(vaultPda, user);

// Для чтения подпись не нужна: «кошелёк», который отказывается подписывать
const readOnlySigner = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: () => Promise.reject(new Error("Подключите кошелёк")),
  signAllTransactions: () => Promise.reject(new Error("Подключите кошелёк")),
};
let readOnlyProgram: Program<SimpleVault> | undefined;

/** Программа для чтения (без кошелька) или для отправки транзакций (с кошельком). */
export function getProgram(wallet?: BrowserWallet): Program<SimpleVault> {
  if (!wallet && readOnlyProgram) return readOnlyProgram;
  const provider = new AnchorProvider(connection, (wallet ?? readOnlySigner) as any, { commitment: "confirmed" });
  const program = new Program<SimpleVault>(idl as SimpleVault, provider);
  if (!wallet) readOnlyProgram = program;
  return program;
}

export interface VaultView {
  admin: PublicKey;
  decimals: number;
  totalTokens: bigint;
  totalShares: bigint;
  inMarket: boolean;
  pairSet: boolean;
  positionOpen: boolean;
}

/** null — vault для этого токена ещё не создан. */
export async function loadVault(): Promise<VaultView | null> {
  const program = getProgram();
  const state = await program.account.vaultState.fetchNullable(vaultPda);
  if (!state) return null;
  const mint = await getMint(connection, TOKEN_MINT);
  return {
    admin: state.admin,
    decimals: mint.decimals,
    totalTokens: toBig(state.totalTokens),
    totalShares: toBig(state.totalShares),
    inMarket: state.inMarket,
    pairSet: !state.tokenMintB.equals(PublicKey.default),
    positionOpen: !state.positionNftMint.equals(PublicKey.default),
  };
}

export interface UserView {
  sol: number; // в SOL
  tokens: bigint; // TOKEN_A на кошельке
  shares: bigint; // share-токены на кошельке
  card: { deposited: bigint; shares: bigint } | null;
}

export async function loadUser(owner: PublicKey): Promise<UserView> {
  const program = getProgram();
  const [lamports, tokens, shares, card] = await Promise.all([
    connection.getBalance(owner),
    tokenBalance(connection, owner, TOKEN_MINT),
    tokenBalance(connection, owner, shareMintPda),
    program.account.userCard.fetchNullable(cardPda(owner)),
  ]);
  return {
    sol: lamports / 1e9,
    tokens,
    shares,
    card: card ? { deposited: toBig(card.deposited), shares: toBig(card.shares) } : null,
  };
}

// ─── Действия пользователя ───────────────────────────────────────────────────

export function createCard(wallet: BrowserWallet): Promise<string> {
  return getProgram(wallet)
    .methods.createUserCard()
    .accountsPartial({ vaultState: vaultPda, userCard: cardPda(wallet.publicKey), user: wallet.publicKey })
    .rpc();
}

function userAccounts(user: PublicKey) {
  return {
    vaultState: vaultPda,
    userCard: cardPda(user),
    vaultTokenAccount: vaultTokensPda,
    shareMint: shareMintPda,
    userTokenAccount: getAssociatedTokenAddressSync(TOKEN_MINT, user),
    userShareAccount: getAssociatedTokenAddressSync(shareMintPda, user),
    user,
  };
}

/** deposit. Если у пользователя ещё нет аккаунта для shares — создаём его в той же транзакции. */
export function deposit(wallet: BrowserWallet, amount: bigint): Promise<string> {
  const accounts = userAccounts(wallet.publicKey);
  return getProgram(wallet)
    .methods.deposit(toBN(amount))
    .accountsPartial(accounts)
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        accounts.userShareAccount,
        wallet.publicKey,
        shareMintPda
      ),
    ])
    .rpc();
}

/** withdraw. Аккаунт для TOKEN_A тоже создаём, если его нет (например, токены пришли на другой кошелёк). */
export function withdraw(wallet: BrowserWallet, shares: bigint): Promise<string> {
  const accounts = userAccounts(wallet.publicKey);
  return getProgram(wallet)
    .methods.withdraw(toBN(shares))
    .accountsPartial(accounts)
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        accounts.userTokenAccount,
        wallet.publicKey,
        TOKEN_MINT
      ),
    ])
    .rpc();
}
