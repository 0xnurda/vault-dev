// Подключение кошелька без лишних библиотек.
// Phantom (и похожие кошельки) кладут в страницу объект `window.phantom.solana`:
// у него есть connect(), signTransaction() и signAllTransactions(). Этого хватает Anchor.
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

type AnyTx = Transaction | VersionedTransaction;

export interface BrowserWallet {
  kind: "injected" | "dev";
  name: string;
  publicKey: PublicKey;
  signTransaction<T extends AnyTx>(tx: T): Promise<T>;
  signAllTransactions<T extends AnyTx>(txs: T[]): Promise<T[]>;
  disconnect(): Promise<void>;
}

interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction<T extends AnyTx>(tx: T): Promise<T>;
  signAllTransactions<T extends AnyTx>(txs: T[]): Promise<T[]>;
  on?(event: string, handler: (...args: any[]) => void): void;
  off?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

function injectedProvider(): InjectedProvider | undefined {
  const w = window as any;
  return w.phantom?.solana ?? w.solana;
}

export const hasInjectedWallet = () => injectedProvider() !== undefined;

export async function connectInjected(onlyIfTrusted = false): Promise<BrowserWallet> {
  const provider = injectedProvider();
  if (!provider) throw new Error("Кошелёк не найден. Установите Phantom: https://phantom.com");
  const { publicKey } = await provider.connect(onlyIfTrusted ? { onlyIfTrusted } : undefined);
  return {
    kind: "injected",
    name: provider.isPhantom ? "Phantom" : "Кошелёк",
    publicKey: new PublicKey(publicKey.toString()),
    signTransaction: (tx) => provider.signTransaction(tx),
    signAllTransactions: (txs) => provider.signAllTransactions(txs),
    disconnect: () => provider.disconnect(),
  };
}

/**
 * Подписка на события Phantom: "accountChanged" (другой аккаунт в кошельке)
 * и "disconnect" (сайт отключили в настройках кошелька). Возвращает отписку.
 */
export function onInjectedEvent(event: "accountChanged" | "disconnect", handler: () => void): () => void {
  const provider = injectedProvider();
  provider?.on?.(event, handler);
  return () => (provider?.off ?? provider?.removeListener)?.call(provider, event, handler);
}

// ─── Тестовый кошелёк (только `yarn dev`) ───────────────────────────────────
// Ключ лежит в localStorage браузера — для devnet и проверки без Phantom.
// В сборку для сайта (`yarn build`) не попадает: App вызывает devWallet() только
// под `import.meta.env.DEV`, и сборщик выкидывает этот код целиком.

const DEV_KEY = "simple-vault:dev-wallet";

function signWith<T extends AnyTx>(kp: Keypair, tx: T): T {
  if (tx instanceof VersionedTransaction) tx.sign([kp]);
  else tx.partialSign(kp);
  return tx;
}

export function devWallet(): BrowserWallet {
  let kp: Keypair;
  const saved = localStorage.getItem(DEV_KEY);
  if (saved) {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  } else {
    kp = Keypair.generate();
    localStorage.setItem(DEV_KEY, JSON.stringify(Array.from(kp.secretKey)));
  }
  return {
    kind: "dev",
    name: "Тестовый кошелёк",
    publicKey: kp.publicKey,
    signTransaction: async (tx) => signWith(kp, tx),
    signAllTransactions: async (txs) => txs.map((tx) => signWith(kp, tx)),
    disconnect: async () => {},
  };
}
