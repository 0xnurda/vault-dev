// Ошибки контракта и кошелька → понятный текст для пользователя.

const CONTRACT_ERRORS: Record<string, string> = {
  ZeroAmount: "Сумма должна быть больше нуля.",
  SharesTooSmall: "Сумма слишком мала: за неё не выйдет ни одного share.",
  VaultEmpty: "В vault ещё никто не вносил токены.",
  WithdrawTooSmall: "Слишком мало shares: за них не выйдет ни одного токена.",
  MathOverflow: "Слишком большая сумма.",
  InMarket: "Деньги vault сейчас в рынке. Внесение и вывод откроются, когда админ вызовет sync_vault.",
  AccountNotInitialized: "Нужный аккаунт ещё не создан (карточка или токен-аккаунт). Обновите страницу и проверьте шаги.",
};

/** Достаёт имя ошибки Anchor (например "InMarket") из того, что бросил `.rpc()`. */
export function anchorErrorName(err: any): string | undefined {
  const direct = err?.error?.errorCode?.code ?? err?.errorCode?.code;
  if (typeof direct === "string") return direct;
  const text = [err?.message, ...(err?.logs ?? []), ...(err?.transactionLogs ?? [])].join("\n");
  return text.match(/Error Code: (\w+)/)?.[1];
}

export function describeError(err: any): string {
  const name = anchorErrorName(err);
  if (name) return CONTRACT_ERRORS[name] ?? `Контракт вернул ошибку ${name}.`;

  const text = [err?.message, ...(err?.logs ?? []), ...(err?.transactionLogs ?? [])].join("\n");
  // Первым: транзакция могла пройти, и любой другой текст («попробуйте ещё раз») ведёт к двойному депозиту
  if (/was not confirmed in|unknown if it succeeded|failed to confirm/i.test(text)) {
    return "Не дождались подтверждения — транзакция могла пройти. Обновите страницу и проверьте балансы, прежде чем повторять.";
  }
  if (err?.code === 4001 || /user rejected|rejected the request/i.test(text)) {
    return "Вы отменили подпись в кошельке.";
  }
  if (/no record of a prior credit|insufficient lamports|insufficient funds for (fee|rent)/i.test(text)) {
    return "Не хватает SOL на комиссию. Попросите админа выполнить yarn faucet <ваш адрес>.";
  }
  // SPL Token: custom program error 0x1 = InsufficientFunds (токенов меньше, чем списываем)
  if (/custom program error: 0x1\b/.test(text)) return "Не хватает токенов на балансе.";
  // только фраза: «429» как подстрока встречается в подписях и логах («consumed 14293 … units»)
  if (/too many requests/i.test(text)) return "Devnet RPC просит подождать (лимит запросов). Попробуйте через минуту.";
  if (/blockhash not found|block height exceeded/i.test(text)) return "Транзакция не успела пройти. Попробуйте ещё раз.";
  if (err?.name === "TokenAccountNotFoundError") {
    return "Аккаунт токена не найден в devnet. Проверьте app/src/vault-config.json (админ: yarn setup-demo).";
  }
  // у ошибок spl-token message бывает пустым — тогда хотя бы имя ошибки
  return err?.message || err?.name || String(err);
}
