# Simple Vault — практика Anchor

Минимальный SPL-токен vault на Anchor 0.31.1.  
Три инструкции: `initialize_vault` → `deposit` → `withdraw`.

---

## Что делает контракт

```
initialize_vault   создаёт VaultState PDA, vault token account, share mint
deposit(amount)    переводит токены в vault → минтит shares пользователю
withdraw(shares)   сжигает shares → возвращает токены пользователю
```

**Формула shares:**
```
Первый депозит:       shares = amount          (1:1)
Последующие:          shares = amount × total_shares / total_tokens
Вывод:                tokens = shares × total_tokens / total_shares
```

---

## Предварительные требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | stable | https://rustup.rs |
| Solana CLI | 1.18+ | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | 18+ | https://nodejs.org |
| Yarn | any | `npm i -g yarn` |

---

## Быстрый старт

### 1. Установить зависимости

```bash
cd vault-simple
yarn install
```

### 2. Сбилдить контракт

```bash
anchor build
```

Артефакты появятся в `target/deploy/`:
- `simple_vault.so` — скомпилированная программа
- `simple_vault-keypair.json` — keypair программы

### 3. Получить Program ID

```bash
anchor keys list
# simple_vault: EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu
```

Если создаёшь **с нуля** (новый keypair):
```bash
# после первого anchor build:
anchor keys sync    # обновит declare_id! в lib.rs и Anchor.toml автоматически
anchor build        # пересобрать с новым ID
```

### 4. Получить devnet SOL

```bash
solana config set --url devnet
solana address                  # покажет твой адрес
solana airdrop 2                # или через https://faucet.solana.com
solana balance
```

> Для деплоя нужно **~2.5 SOL** на devnet.

### 5. Задеплоить на devnet

```bash
anchor deploy --provider.cluster devnet
```

Успешный вывод:
```
Program Id: EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu
Deploy success
```

### 6. Запустить тесты

```bash
anchor test --provider.cluster devnet --skip-local-validator
```

---

## Структура проекта

```
vault-simple/
├── Anchor.toml                  # конфиг: cluster=devnet, program ID
├── Cargo.toml                   # workspace
├── package.json
├── tsconfig.json
├── programs/
│   └── simple_vault/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs           # весь контракт (инструкции + аккаунты + ошибки)
└── tests/
    └── vault.ts                 # TypeScript тесты (два пользователя)
```

---

## Тест-сценарий

Тесты (`tests/vault.ts`) покрывают:

1. **initialize_vault** — vault создан, `total_tokens=0`, `total_shares=0`
2. **UserA deposit 100** — получает 100 shares (1:1, первый депозит)
3. **UserB deposit 50** — получает 50 shares, соотношение A/B = 66.7%/33.3%
4. **UserA withdraw 50 shares** — получает 50 токенов обратно
5. **Итог** — UserA и UserB по 50 shares (50%/50%), on-chain баланс совпадает с vault state

---

## PDAs (Seeds)

| PDA | Seeds |
|---|---|
| `vault_state` | `["vault", token_mint]` |
| `vault_token_account` | `["vault_tokens", token_mint]` |
| `share_mint` | `["share_mint", token_mint]` |

---

## Возможные ошибки

| Ошибка | Причина |
|---|---|
| `insufficient funds` при деплое | Нужно больше SOL → `solana airdrop` или https://faucet.solana.com |
| `AccountNotInitialized` в тестах | Забыл задеплоить или указан неверный cluster |
| `ZeroAmount` | Передан `amount = 0` |
| `SharesTooSmall` | Депозит слишком мал относительно TVL vault |

---

## Задание для практики

Реализовать самостоятельно или изменить:

- [ ] Добавить **комиссию 1%** при депозите (переводить на `fee_wallet`)
- [ ] Добавить **паузу** (`is_paused: bool`) — admin может остановить депозиты
- [ ] Добавить **минимальный депозит** (например, ≥ 1 токен)
- [ ] Написать тест: **три пользователя** делают deposit → все выводят → vault пуст
