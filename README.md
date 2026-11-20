# Simple Vault — практика Anchor

Учебный контракт на Anchor 0.31.1 (Solana). Что он умеет по неделям:

1. **Vault создан** — админ создаёт vault для SPL-токена. *(неделя 8)*
2. **У каждого пользователя своя «карточка»** — личный аккаунт (PDA) внутри vault. *(неделя 8)*
3. **Депозит и share-токены** — пользователь вносит токены и получает share-токены. *(неделя 9)*
4. **CPI и вывод** — пользователь возвращает share-токены и забирает свои токены. *(неделя 10)*
5. **Свои токены и свой CLMM-пул на Raydium (devnet)** — скрипт `create-pool`, сам контракт на этой неделе не меняется. *(неделя 11)*
6. **Swap через Raydium** — vault обменивает свои токены через ваш пул. *(неделя 12)*
7. **Позиция в CLMM-пуле** — vault открывает позицию в диапазоне, собирает комиссии и закрывает её. *(неделя 13)*

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA — личную карточку пользователя в vault
deposit(amount)     переводит токены пользователя в vault → печатает ему shares
withdraw(shares)    сжигает shares пользователя → отправляет ему токены из vault

add_pair_token      админ заводит vault второй токен пары (TOKEN_B пула)
swap                неделя 12: админ меняет токены vault через пул Raydium
open_position       неделя 13: админ кладёт A и B vault в ценовой диапазон
collect_fees        неделя 13: админ забирает комиссии позиции в vault
close_position      неделя 13: админ выводит всё из позиции и закрывает её
sync_vault          админ возвращает vault в обычный режим, когда всё снова в TOKEN_A
```

Код Raydium-инструкций лежит отдельно: `programs/simple_vault/src/raydium.rs`.

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

## Неделя 11 — свои токены и свой CLMM-пул на Raydium

### Идея простыми словами

- **AMM** (automated market maker) — пул, в котором два токена лежат вместе, а цена считается по формуле. Обмен идёт прямо с пулом, без биржевого стакана.
- **Концентрированная ликвидность (CLMM)** — поставщик ликвидности не раскидывает деньги по всем ценам от 0 до бесконечности, а выбирает **ценовой диапазон**. Деньги работают только пока цена внутри диапазона, зато комиссий в нём зарабатывается больше.
- На этой неделе мы только **создаём** пул: два наших токена и пул Raydium CLMM на devnet. Позиции и swap будут на следующих неделях.

### Что делает скрипт

`scripts/create-clmm-pool.ts`:

1. Создаёт два тестовых SPL-токена (`TOKEN_A`, `TOKEN_B`, по 6 decimals) и минтит по 1 000 000 каждого на твой кошелёк.
2. Берёт из API Raydium (devnet) конфиг комиссий (шаг тика 60, комиссия 0.25%).
3. Создаёт пул `TOKEN_A / TOKEN_B` в программе Raydium CLMM со стартовой ценой 1 (1 `TOKEN_A` = 1 `TOKEN_B`).
4. Сохраняет адреса в `devnet-pool.json` (файл в `.gitignore`: у каждого студента свои токены и пул).

### Запуск

Нужен баланс на devnet (хватит ~1 SOL) и настроенный `solana config set --url devnet` (шаги 3–4 из «Быстрого старта»).

```bash
yarn install
yarn create-pool
```

Ожидаемый вывод (адреса у тебя будут свои):

```
[1/3] Создаю тестовые токены...
  TOKEN_A: <mint>
  TOKEN_B: <mint>
[2/3] Создаю CLMM-пул на Raydium devnet...
  Pool: <адрес пула>
  Tx  : https://explorer.solana.com/tx/...?cluster=devnet
[3/3] Сохраняю devnet-pool.json
```

Открой ссылку на пул в Solana Explorer (cluster = devnet): владелец аккаунта должен быть
`DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH` — это программа Raydium CLMM на devnet.

Пара полезных переменных окружения: `ANCHOR_WALLET` (другой кошелёк) и `DEVNET_RPC` (свой RPC, если публичный отвечает `429`).

### Что сдавать

Ссылку на коммит со скриптом и адрес своего пула (`poolId` из `devnet-pool.json`) со ссылкой на Explorer.

> Токены здесь без метаданных (имени и иконки): для учебного пула это не нужно, в Explorer они видны просто адресами.

---

## Недели 12–13 — vault работает с Raydium

### Главная идея: деньги vault «уходят в рынок»

До недели 12 все деньги vault лежали в одном токене (TOKEN_A), и `total_tokens` всегда был равен
балансу vault. Теперь админ может обменять часть TOKEN_A на TOKEN_B или положить их в позицию Raydium.
В это время непонятно, сколько стоит vault в TOKEN_A, а значит, нельзя честно посчитать shares.

Поэтому правило простое:

1. Как только админ делает `swap` или `open_position`, vault переходит в режим **«в рынке»** (`in_market = true`).
   `deposit` и `withdraw` в это время возвращают ошибку `InMarket`.
2. Когда админ закрыл позицию и обменял весь TOKEN_B обратно, он вызывает `sync_vault`
   (удобнее всего — одной транзакцией вместе с `swap(B → A, весь баланс)`, см. ниже).
   Контракт проверяет, что TOKEN_B = 0 и позиции нет, берёт `total_tokens` из **реального баланса** TOKEN_A
   и снимает паузу.
3. Прибыль (комиссии) или убыток (комиссия обмена, проскальзывание) автоматически делится между всеми
   держателями shares: shares не меняются, меняется `total_tokens`.

Все Raydium-инструкции вызывает только **админ** (иначе `Unauthorized`).

### `add_pair_token`

Админ один раз указывает второй токен пары. Создаётся токен-аккаунт vault для TOKEN_B:
seeds `["vault_tokens_b", token_mint]`, владелец — vault PDA. В `VaultState` записываются `token_mint_b`
и `vault_token_account_b`. Повторно вызвать нельзя: пара у vault задаётся один раз.

### Неделя 12: `swap(amount_in, min_amount_out, a_to_b)`

Vault меняет `amount_in` своих токенов через пул Raydium CLMM (`a_to_b = true`: A → B, иначе B → A).

- Это **CPI в Raydium** (`swap_v2`). Платит и подписывает vault PDA: токены его.
- `min_amount_out` — защита от проскальзывания. Если пул отдаст меньше, Raydium откатит всю транзакцию
  (`TooLittleOutputReceived`).
- `amount_in = u64::MAX` — обменять **весь** баланс входного токена. Сумма берётся на цепочке в момент
  выполнения. Это важно для возврата в TOKEN_A: TOKEN_B на аккаунт vault может перевести кто угодно, и если
  админ передаст сумму, посчитанную заранее, на аккаунте останется «пыль», а `sync_vault` упадёт.
  Поэтому правильно так — **одной транзакцией**:

  ```ts
  const syncIx = await program.methods.syncVault().accounts({...}).instruction();
  await program.methods.swap(U64_MAX, minOut, false).accounts({...}).postInstructions([syncIx]).rpc();
  ```
- Контракт проверяет, что пул — это именно пара TOKEN_A / TOKEN_B vault (`WrongPool`).
- Клиент передаёт в `remaining_accounts` tick arrays по пути обмена. Их подсказывает SDK:
  `PoolUtils.computeAmountOutFormat(...).remainingAccounts` (пример — в `tests/raydium.ts`).

### Неделя 13: позиция с концентрированной ликвидностью

**`open_position(tick_lower, tick_upper, tick_array_lower_start, tick_array_upper_start, amount_0_max, amount_1_max, base_0)`**

- Vault кладёт TOKEN_A и TOKEN_B в ценовой диапазон `[tick_lower, tick_upper]`.
- Ликвидность считает сам Raydium: от `amount_0_max` (если `base_0 = true`) или от `amount_1_max`.
  Второй токен он возьмёт сколько нужно, но не больше указанного максимума.
- `amount_0` / `amount_1` — это токены пула в **его** порядке (token_0 — меньший адрес mint), а не A/B vault.
  Какой токен vault — token_0, контракт определяет сам.
- **NFT позиции принадлежит vault PDA.** Ренту за NFT и служебные аккаунты Raydium платит админ.
- Raydium списывает токены от имени того, кто платит (админа). Поэтому контракт на время вызова даёт админу
  разрешение (`approve`) потратить не больше `amount_*_max` с аккаунтов vault и сразу после вызова его снимает (`revoke`).
- Одновременно открыта только одна позиция (`PositionAlreadyOpen`).

**`collect_fees`** — забирает накопленные комиссии позиции в vault. Внутри это `decrease_liquidity_v2`
с ликвидностью 0: Raydium отдаёт только комиссии, позиция и её ликвидность остаются.

**`close_position(amount_0_min, amount_1_min)`** — выводит всю ликвидность и остаток комиссий в vault и
закрывает позицию. `amount_0_min` / `amount_1_min` — защита от проскальзывания, и они тоже **в порядке токенов
пула** (token_0 / token_1), а не A/B vault.

Raydium возвращает ренту закрытых аккаунтов (`personal_position`, NFT-аккаунт) на vault PDA — владельца NFT.
Платил её админ в `open_position`, поэтому контракт сразу переводит админу всё, что на vault PDA сверх
минимума для хранения `VaultState`. Так можно: аккаунт vault принадлежит нашей программе, и она может
списывать с него лампорты напрямую.

### `sync_vault`

Возвращает vault в обычный режим. Работает, только если позиции нет (иначе `PositionOpen`)
и TOKEN_B = 0 (иначе `TokenBNotZero`).

### Полный сценарий (как в `tests/raydium.ts`)

```
1. admin: свои TOKEN_A / TOKEN_B, CLMM-пул (цена 1), ликвидность кошельком admin
2. admin: initialize_vault(TOKEN_A), add_pair_token(TOKEN_B)
3. user:  create_user_card, deposit 1000 A
4. admin: swap 300 A → B                     → in_market, deposit/withdraw на паузе
5. admin: open_position (цены 0.8 – 1.25)
6. кто-то торгует в пуле                     → позиции vault капают комиссии
7. admin: collect_fees, close_position       → рента позиции возвращается админу
8. admin: swap(весь B → A) + sync_vault      → одной транзакцией; total_tokens = реальный баланс A
9. user:  withdraw всех shares               → получает весь TOKEN_A vault
```

Отдельно тесты проверяют второй vault: позиция, открытая без swap, тоже ставит `in_market`.

### Ограничения учебной версии

- Работает только на **devnet**: crate `raydium-clmm-cpi` собран с feature `devnet`, адрес программы CLMM вшит.
- Пул не закреплён за vault: админ может выбрать любой пул пары TOKEN_A / TOKEN_B. Админу здесь доверяют полностью.
- Награды пула (rewards) не собираются. Если у пула включены награды, `close_position` упадёт в Raydium.
- Одновременно только одна позиция.

В одном из прогонов `total_tokens` после всего стал `1000 → 997.97`: комиссия обменов vault (0.25%)
оказалась больше, чем позиция заработала комиссий. Это нормально и хорошо показывает, откуда в DeFi берутся
прибыль и убыток.

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
JS-зависимости (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `@raydium-io/raydium-sdk-v2`, `decimal.js`, `ts-node`, `mocha`, `chai`, `typescript`) — через `yarn install`.

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

Для деплоя нужно ~2 SOL. С недели 12 программа включает Raydium CPI и весит ~500 КБ: нужно ~4 SOL
на новый деплой. Если обновляешь уже задеплоенную программу и `anchor deploy` пишет, что не хватает места,
расширь её (сумма в байтах, ~0.7 SOL за 100 КБ):

```bash
solana program extend <PROGRAM_ID> 100000 --url devnet
```

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

simple_vault + Raydium CLMM (недели 12–13)
✔ add_pair_token: не админ — ошибка
✔ add_pair_token: vault получает аккаунт для TOKEN_B
✔ swap: не админ — ошибка
✔ swap: пул другой пары (A / C) — ошибка WrongPool
✔ swap: хранилища пула перепутаны местами — ошибка WrongPool
✔ swap: min_amount_out выше реального выхода — откат
✔ swap: vault меняет 300 A → B через пул
✔ deposit и withdraw на паузе, пока деньги в рынке
✔ sync_vault: есть TOKEN_B — ошибка TokenBNotZero
✔ sync_vault: не админ — ошибка
✔ open_position: не админ — ошибка
✔ open_position: пул другой пары — ошибка WrongPool
✔ open_position: vault кладёт A и B в диапазон 0.8–1.25
✔ open_position: вторая позиция — ошибка
✔ collect_fees / close_position: не админ — ошибка
✔ collect_fees: чужая позиция в том же пуле — ошибка NoOpenPosition
✔ collect_fees: после торговли в пуле vault забирает только комиссии
✔ close_position: ликвидность возвращается в vault, рента — админу
✔ swap всего B → A + sync_vault одной транзакцией, даже если кто-то докинул B
✔ withdraw: пользователь выводит все shares и получает весь TOKEN_A vault
✔ swap B → A тоже переводит vault в рынок
  второй vault (на TOKEN_B, пара — TOKEN_A)
  ✔ open_position без swap ставит in_market (позиция только из своего токена, вне цены)
  ✔ sync_vault: TOKEN_B = 0, но позиция открыта — ошибка PositionOpen
  ✔ close_position + sync_vault: vault2 снова в обычном режиме
36 passing
```

Тесты Raydium каждый раз создают свои токены и два пула и тратят ~0.5 SOL devnet (рента пулов, tick arrays и позиций остаётся на devnet). Только их можно запустить так:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 600000 tests/raydium.ts
```

---

## Структура проекта

```
vault-simple/
├── programs/simple_vault/src/lib.rs   # контракт: vault, карточки, deposit, withdraw
├── programs/simple_vault/src/raydium.rs  # недели 12–13: swap и позиция Raydium (CPI)
├── scripts/create-clmm-pool.ts        # неделя 11: токены и CLMM-пул на Raydium
├── tests/vault.ts                     # тесты недель 8–10
├── tests/raydium.ts                   # тесты недель 12–13 (свой пул на devnet)
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
| `429 Too Many Requests` | лимит публичного devnet RPC | подожди или возьми свой RPC (`DEVNET_RPC`) |
| `yarn create-pool` падает на `Insufficient funds` | мало SOL на devnet | пополни кошелёк (faucet.solana.com) |
| `InMarket` при `deposit` / `withdraw` | деньги vault в TOKEN_B или в позиции | админ: `close_position`, swap B → A, `sync_vault` |
| `PositionOpen` при `sync_vault` | позиция ещё открыта | сначала `close_position` |
| `TokenBNotZero` при `sync_vault` | на vault остался TOKEN_B | `swap(u64::MAX, …, a_to_b = false)` и `sync_vault` одной транзакцией |
| `WrongPool` | пул другой пары или перепутаны хранилища пула | проверь `poolState`, `inputVault` / `outputVault` |
| `NoOpenPosition` | передана не та позиция (или позиции нет) | NFT и `personal_position` должны быть от позиции vault |
| `Unauthorized` | Raydium-инструкцию вызвал не админ | подписывай кошельком админа vault |
| `TooLittleOutputReceived` | обмен дал меньше `min_amount_out` | уменьши `min_amount_out` или сумму обмена |
| `PositionAlreadyOpen` | позиция уже открыта | сначала `close_position` |
| `InvalidAccountData` сразу после создания токена | нода devnet ещё не видит новый аккаунт | используй commitment `confirmed` (как в `tests/raydium.ts`) |
| `account data too small` при деплое | программа выросла | `solana program extend <PROGRAM_ID> 100000 --url devnet` |

---

## Задания для практики

1. Добавить комиссию 1% на депозит и отправлять её на `fee_wallet`.
2. Добавить минимальный депозит (например, 1 токен).
3. Добавить флаг `paused` в `VaultState`: админ может остановить депозиты.
4. Написать тест: трое пользователей вносят разные суммы, проверить доли по shares.
5. Добавить инструкцию `withdraw_all`, которая сжигает все shares пользователя за один вызов.
6. Закрывать карточку (`close`), если у пользователя не осталось shares, и возвращать ренту.
7. *(нед. 12)* Ограничить `swap`: не больше 50% TOKEN_A vault за один обмен.
8. *(нед. 13)* Добавить `increase_liquidity`: докладывать токены в уже открытую позицию.
9. *(нед. 13)* Считать в `VaultState`, сколько всего комиссий vault собрал за всё время.
