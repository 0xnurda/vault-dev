import { useCallback, useEffect, useRef, useState } from "react";
import { ActionForm } from "./components/ActionForm";
import { EXPLORER, TOKEN_MINT, TOKEN_SYMBOL } from "./config";
import { formatAmount } from "./lib/amount";
import { describeError } from "./lib/errors";
import { previewShares, previewWithdraw } from "./lib/math";
import {
  createCard,
  deposit,
  loadUser,
  loadVault,
  vaultPda,
  withdraw,
  type UserView,
  type VaultView,
} from "./lib/vault";
import {
  connectInjected,
  devWallet,
  hasInjectedWallet,
  onInjectedEvent,
  type BrowserWallet,
} from "./lib/wallet";

const SHARE_DECIMALS = 6; // share_mint в контракте: mint::decimals = 6
const MIN_SOL = 0.005; // примерно на создание карточки и пары аккаунтов

type Status = { kind: "ok" | "error"; text: string; sig?: string } | null;

const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

export default function App() {
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [vault, setVault] = useState<VaultView | null | undefined>(undefined); // undefined = грузим
  const [user, setUser] = useState<UserView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // Текущий кошелёк для асинхронного кода: замыкание могло запомнить уже старый
  const walletRef = useRef<BrowserWallet | null>(null);
  walletRef.current = wallet;
  const requestId = useRef(0);
  // Пользователь сам нажал «Подключить» или «Отключить» — тихое автоподключение больше не вмешивается
  const userChoseWallet = useRef(false);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const w = walletRef.current;
    // Ответ устарел, если за это время начался новый запрос или сменился кошелёк:
    // иначе медленный ответ для кошелька A перезапишет данные кошелька B
    const stale = () => id !== requestId.current || walletRef.current !== w;
    try {
      const [v, u] = await Promise.all([loadVault(), w ? loadUser(w.publicKey) : null]);
      if (stale()) return;
      setVault(v);
      setUser(u);
      setLoadError("");
    } catch (e) {
      if (stale()) return;
      setLoadError(describeError(e));
    }
  }, []);

  // Сменился кошелёк — сразу убираем чужие балансы и грузим свои
  useEffect(() => {
    setUser(null);
    setLoadError("");
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [wallet, refresh]);

  // Phantom: тихое подключение, если сайт уже разрешён; смена аккаунта; отключение из кошелька.
  // Тестовый кошелёк события Phantom не трогают.
  useEffect(() => {
    if (!hasInjectedWallet()) return;
    const usingPhantom = () => walletRef.current?.kind === "injected";
    connectInjected(true)
      .then((w) => {
        if (!userChoseWallet.current) setWallet(w); // пользователь мог уже выбрать кошелёк или отключиться
      })
      .catch(() => {});
    const offAccount = onInjectedEvent("accountChanged", () => {
      if (!usingPhantom()) return;
      connectInjected(true)
        .then((w) => usingPhantom() && setWallet(w))
        .catch(() => usingPhantom() && setWallet(null));
    });
    const offDisconnect = onInjectedEvent("disconnect", () => usingPhantom() && setWallet(null));
    return () => {
      offAccount();
      offDisconnect();
    };
  }, []);

  async function connect(kind: "injected" | "dev") {
    userChoseWallet.current = true;
    setStatus(null);
    try {
      // import.meta.env.DEV = false в `yarn build` — код тестового кошелька туда не попадёт
      setWallet(import.meta.env.DEV && kind === "dev" ? devWallet() : await connectInjected());
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
    }
  }

  async function disconnect() {
    userChoseWallet.current = true;
    await wallet?.disconnect().catch(() => {});
    setWallet(null);
    setStatus(null);
  }

  /** Отправить транзакцию, показать результат и обновить данные. */
  async function run(okText: string, send: () => Promise<string>): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    try {
      const sig = await send();
      setStatus({ kind: "ok", text: okText, sig });
      return true;
    } catch (e) {
      console.error(e);
      setStatus({ kind: "error", text: describeError(e) });
      return false;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const tokenFmt = (raw: bigint) => `${formatAmount(raw, vault?.decimals ?? 6)} ${TOKEN_SYMBOL}`;
  const shareFmt = (raw: bigint) => `${formatAmount(raw, SHARE_DECIMALS)} shares`;

  const pausedReason = vault?.inMarket
    ? "Деньги vault сейчас в рынке (swap или позиция Raydium). Внесение и вывод откроются после sync_vault."
    : undefined;

  return (
    <div className="page">
      <header>
        <div>
          <h1>Simple Vault</h1>
          <p className="muted">
            Учебный vault на Solana <span className="badge">devnet</span>
          </p>
        </div>
        <div className="wallet">
          {wallet ? (
            <>
              <button className="ghost" title="Скопировать адрес" onClick={() => navigator.clipboard?.writeText(wallet.publicKey.toBase58())}>
                {wallet.name}: {short(wallet.publicKey.toBase58())}
              </button>
              <button className="ghost" onClick={disconnect}>
                Отключить
              </button>
            </>
          ) : (
            <>
              <button onClick={() => connect("injected")}>Подключить Phantom</button>
              {import.meta.env.DEV && (
                <button className="ghost" onClick={() => connect("dev")}>
                  Тестовый кошелёк
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {status && (
        <div className={`status ${status.kind}`} role="status">
          {status.text}{" "}
          {status.sig && (
            <a href={EXPLORER("tx", status.sig)} target="_blank" rel="noreferrer">
              Транзакция в Explorer
            </a>
          )}
        </div>
      )}
      {loadError && <div className="status error">Не удалось загрузить данные: {loadError}</div>}

      <section className="card">
        <h2>Vault</h2>
        {vault === undefined && <p className="muted">Загружаем…</p>}
        {vault === null && (
          <p>
            Vault для токена <code>{short(TOKEN_MINT.toBase58())}</code> ещё не создан. Админ: в корне проекта
            выполните <code>yarn setup-demo</code>.
          </p>
        )}
        {vault && (
          <>
            <dl className="stats">
              <div>
                <dt>Всего в vault</dt>
                <dd>{tokenFmt(vault.totalTokens)}</dd>
              </div>
              <div>
                <dt>Выпущено shares</dt>
                <dd>{shareFmt(vault.totalShares)}</dd>
              </div>
              <div>
                <dt>{vault.inMarket ? "Цена 1 share до выхода в рынок" : "Цена 1 share"}</dt>
                <dd>
                  {vault.totalShares === 0n
                    ? `1 ${TOKEN_SYMBOL}`
                    : tokenFmt(previewWithdraw(10n ** BigInt(SHARE_DECIMALS), vault.totalTokens, vault.totalShares))}
                </dd>
              </div>
              <div>
                <dt>Режим</dt>
                <dd>{vault.inMarket ? <span className="warn">Деньги в рынке</span> : "Обычный"}</dd>
              </div>
            </dl>
            <p className="muted small">
              Пара для Raydium: {vault.pairSet ? "задана" : "не задана"} · Позиция в пуле:{" "}
              {vault.positionOpen ? "открыта" : "нет"} · Админ:{" "}
              <a href={EXPLORER("address", vault.admin.toBase58())} target="_blank" rel="noreferrer">
                {short(vault.admin.toBase58())}
              </a>{" "}
              · Vault:{" "}
              <a href={EXPLORER("address", vaultPda.toBase58())} target="_blank" rel="noreferrer">
                {short(vaultPda.toBase58())}
              </a>
            </p>
          </>
        )}
      </section>

      {vault && (
        <section className="card">
          <h2>Мой счёт</h2>
          {!wallet && <p className="muted">Подключите кошелёк, чтобы вносить и выводить токены.</p>}
          {wallet && !user && <p className="muted">Загружаем…</p>}
          {wallet && user && (
            <>
              <dl className="stats">
                <div>
                  <dt>SOL</dt>
                  <dd>{user.sol.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>{TOKEN_SYMBOL} на кошельке</dt>
                  <dd>{tokenFmt(user.tokens)}</dd>
                </div>
                <div>
                  <dt>Мои shares</dt>
                  <dd>{shareFmt(user.shares)}</dd>
                </div>
                <div>
                  {/* total_tokens обновляется только на sync_vault — пока деньги в рынке, цифра старая */}
                  <dt>{vault.inMarket ? "Стоили до выхода в рынок" : "Они стоят сейчас"}</dt>
                  <dd>{tokenFmt(previewWithdraw(user.shares, vault.totalTokens, vault.totalShares))}</dd>
                </div>
              </dl>

              {(user.sol < MIN_SOL || user.tokens === 0n) && (
                <p className="note">
                  Нужны тестовые SOL и {TOKEN_SYMBOL}. Попросите админа выполнить в корне проекта:
                  <br />
                  <code>yarn faucet {wallet.publicKey.toBase58()}</code>
                </p>
              )}

              {!user.card ? (
                <div className="action">
                  <h3>Шаг 1. Карточка</h3>
                  <p className="hint">
                    Карточка — ваш личный аккаунт в vault (PDA). Без неё контракт не примет депозит. Создаётся один
                    раз, стоит ~0.001 SOL ренты.
                  </p>
                  <button
                    disabled={busy || user.sol < MIN_SOL}
                    onClick={() => run("Карточка создана.", () => createCard(wallet))}
                  >
                    {busy ? "Ждём подтверждения…" : "Создать карточку"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="muted small">
                    Карточка: внесено {tokenFmt(user.card.deposited)}, shares по карточке {shareFmt(user.card.shares)}
                  </p>
                  {/* key: при смене кошелька формы создаются заново, введённые суммы не переносятся */}
                  <div className="actions" key={wallet.publicKey.toBase58()}>
                    <ActionForm
                      title="Внести"
                      unit={TOKEN_SYMBOL}
                      decimals={vault.decimals}
                      max={user.tokens}
                      busy={busy}
                      blockedReason={pausedReason}
                      submitLabel="Внести"
                      previewOut={(a) => previewShares(a, vault.totalTokens, vault.totalShares)}
                      formatOut={shareFmt}
                      onSubmit={(a) => run(`Внесено ${tokenFmt(a)}.`, () => deposit(wallet, a))}
                    />
                    <ActionForm
                      title="Вывести"
                      unit="shares"
                      decimals={SHARE_DECIMALS}
                      max={user.shares}
                      busy={busy}
                      blockedReason={pausedReason}
                      submitLabel="Вывести"
                      previewOut={(s) => previewWithdraw(s, vault.totalTokens, vault.totalShares)}
                      formatOut={tokenFmt}
                      onSubmit={(s) => run(`Выведено ${shareFmt(s)}.`, () => withdraw(wallet, s))}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      <footer className="muted small">
        Swap, позицию Raydium и sync_vault выполняет админ скриптами и тестами (недели 12–13). Сайт только
        показывает, в каком режиме vault.
      </footer>
    </div>
  );
}
