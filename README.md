# Simple Vault — практика Anchor

Учебный контракт на Anchor 0.31.1 (Solana). Сейчас он делает четыре вещи:

1. **Vault создан** — админ создаёт vault для SPL-токена. *(неделя 8)*
2. **У каждого пользователя своя «карточка»** — личный аккаунт (PDA) внутри vault. *(неделя 8)*
3. **Депозит и share-токены** — пользователь вносит токены и получает share-токены. *(неделя 9)*
4. **CPI и вывод** — пользователь возвращает share-токены и забирает свои токены. *(неделя 10)*

Контракт будет дорабатываться (Raydium и т.д.), поэтому он намеренно небольшой.

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA — личную карточку пользователя в vault
deposit(amount)     переводит токены пользователя в vault → печатает ему shares
withdraw(shares)    сжигает shares пользователя → отправляет ему токены из vault
```

### `initialize_vault`

Вызывает админ (платит за аккаунты). Создаёт три аккаунта для выбранного `token_mint`:

| Аккаунт | Seeds | Что хранит |
|---|---|---|
| `vault_state` | `["vault", token_mint]` | admin, token_mint, адреса token account и share mint, `total_tokens`, `total_shares`, bump |
| `vault_token_account` | `["vault_tokens", token_mint]` | токен-аккаунт, владелец — vault PDA |
| `share_mint` | `["share_mint", token_mint]` | mint для shares (6 decimals), authority — vault PDA |

### `create_user_card`

Вызывает любой пользователь (платит за свою карточку). Создаёт `UserCard`:

| Поле | Описание |
|---|---|
| `vault` | к какому vault относится карточка |
| `owner` | владелец карточки |
| `deposited` | сколько токенов пользователь сейчас держит в vault (растёт при депозите, уменьшается при выводе) |
| `shares` | сколько share-токенов он получил и ещё не вернул |
| `bump` | bump PDA |

Seeds: `["user_card", vault_state, user]` — поэтому у одного пользователя в одном vault
может быть **только одна** карточка. Повторный вызов завершится ошибкой.

### `deposit(amount)`

Пользователь вносит `amount` токенов и получает share-токены — «квитанции» с его долей в vault.
**Депозит возможен только после `create_user_card`** — без карточки инструкция вернёт ошибку.

Что происходит по шагам:

1. Считается, сколько shares положено пользователю.
2. Токены переводятся с токен-аккаунта пользователя в `vault_token_account`.
3. Vault печатает shares на share-аккаунт пользователя (подписывает сам vault PDA).
4. Обновляются `total_tokens` и `total_shares` в vault, а также `deposited` и `shares` в карточке.

**Формула shares:**

```
Первый депозит:       shares = amount                         (1:1)
Последующие депозиты: shares = amount × total_shares / total_tokens
```

Пример: A вносит 100 токенов → получает 100 shares. Потом B вносит 50 → получает 50 shares.
В vault 150 токенов и 150 shares, у A доля 2/3, у B — 1/3.

Ошибки: `ZeroAmount` (сумма 0), `SharesTooSmall` (депозит слишком мал, shares вышло бы 0), `MathOverflow`.

### `withdraw(shares_amount)`

Обратная операция: пользователь возвращает `shares_amount` share-токенов и забирает свои токены.
Как и депозит, вывод работает только с карточкой.

**Формула:** `tokens = shares × total_tokens / total_shares`

Что происходит по шагам:

1. Считается, сколько токенов положено за эти shares.
2. **CPI в Token program (`burn`)** — shares пользователя сжигаются. Подписывает сам пользователь.
3. **CPI в Token program (`transfer`)** — токены уходят из `vault_token_account` пользователю.
   Подписывает **vault PDA**: у него нет приватного ключа, программа подписывает за него
   с помощью seeds (`invoke_signed`, в Anchor — `CpiContext::new_with_signer`).
4. Обновляются `total_tokens` и `total_shares` в vault и поля карточки.

Пример: в vault 150 токенов и 150 shares. A возвращает 50 shares → получает 50 токенов.
В vault остаётся 100 токенов и 100 shares.

> **Что такое CPI.** Cross-Program Invocation — один контракт вызывает другой.
> В `deposit` и `withdraw` наш контракт вызывает Token program (`transfer`, `mint_to`, `burn`).
> Когда нужна подпись PDA, вызов делается «с подписью» через seeds — это и есть главная идея недели 10.

Ошибки: `ZeroAmount` (0 shares), `VaultEmpty` (в vault нет shares), `WithdrawTooSmall`
(за такие shares вышло бы 0 токенов), `MathOverflow`. Если shares у пользователя меньше,
чем он хочет вернуть, упадёт сам `burn` (Token program).

Для вызова `deposit` и `withdraw` нужны: токен-аккаунт пользователя (с токенами vault) и share-аккаунт пользователя
(для share mint). В тестах они создаются через `createAccount` из `@solana/spl-token`.

---

## Требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | stable | https://rustup.rs |
| Solana CLI | 1.18+ | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | 18+ | https://nodejs.org |
| Yarn | any | `npm i -g yarn` |

Rust-зависимости (`anchor-lang`, `anchor-spl` 0.31.1) подтянутся сами при `anchor build`.
JS-зависимости (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `mocha`, `chai`, `typescript`) — через `yarn install`.

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

Если билдишь **первый раз** (новый keypair):

```bash
anchor keys sync   # обновит declare_id! в lib.rs и Anchor.toml
anchor build       # пересобрать с правильным ID
```

Артефакты в `target/deploy/`:
- `simple_vault.so` — программа
- `simple_vault-keypair.json` — keypair (не коммитить!)

### 3. Настроить Solana CLI на devnet

```bash
solana config set --url devnet
solana address     # твой публичный ключ — запомни его
solana balance
```

### 4. Пополнить кошелёк

Для деплоя нужно ~2 SOL.

```bash
solana airdrop 2   # может не сработать из-за rate limit
```

Если rate limit — используй faucet:
- https://faucet.solana.com (вставь свой адрес)

### 5. Задеплоить

```bash
anchor deploy --provider.cluster devnet
```

### 6. Запустить тесты

```bash
yarn test
```

Ожидаемый вывод:

```
✔ initialize_vault: vault создан
✔ create_user_card: у каждого пользователя своя карточка
✔ create_user_card: вторая карточка для того же пользователя — ошибка
✔ deposit: A вносит 100 токенов → получает 100 shares
✔ deposit: B вносит 50 токенов → получает 50 shares
✔ deposit: без карточки — ошибка
✔ deposit: сумма 0 — ошибка
✔ withdraw: A возвращает 50 shares → получает 50 токенов
✔ withdraw: B выводит всё → shares сожжены, токены возвращены
✔ withdraw: сумма 0 — ошибка
✔ withdraw: больше своих shares — ошибка
✔ withdraw: без карточки — ошибка
12 passing
```

---

## Структура проекта

```
vault-simple/
├── programs/simple_vault/src/lib.rs   # контракт
├── tests/vault.ts                     # тесты
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Частые ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `Insufficient funds` при деплое | мало SOL | пополни кошелёк на devnet |
| `AccountNotInitialized` в тестах | программа не задеплоена или другой ID | `anchor keys sync` → `anchor build` → `anchor deploy` |
| `already in use` при `create_user_card` | у пользователя уже есть карточка | это ожидаемо, карточка одна на пользователя |
| `AccountNotInitialized` (`user_card`) при `deposit` | нет карточки | сначала вызови `create_user_card` |
| `ZeroAmount` | `amount = 0` | вноси / выводи сумму больше нуля |
| `VaultEmpty` | в vault нет shares | сначала кто-то должен сделать `deposit` |
| `insufficient funds` при `withdraw` | shares меньше, чем просишь вернуть | проверь баланс share-аккаунта |
| `SharesTooSmall` | депозит слишком мал относительно vault | увеличь сумму |
| `429 Too Many Requests` | лимит публичного devnet RPC | подожди или возьми свой RPC |

---

## Задания для практики

1. Добавить комиссию 1% на депозит и отправлять её на `fee_wallet`.
2. Добавить минимальный депозит (например, 1 токен).
3. Добавить флаг `paused` в `VaultState`: админ может остановить депозиты.
4. Написать тест: трое пользователей вносят разные суммы, проверить доли по shares.
5. Добавить инструкцию `withdraw_all`, которая сжигает все shares пользователя за один вызов.
6. Закрывать карточку (`close`), если у пользователя не осталось shares, и возвращать ренту.
