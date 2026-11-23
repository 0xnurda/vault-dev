import { useState } from "react";
import { formatAmount, parseAmount } from "../lib/amount";

interface Props {
  title: string;
  unit: string; // что вводим: TOKEN_A или shares
  decimals: number;
  max: bigint; // сколько есть у пользователя
  /** Сколько пользователь получит за `amount` (та же формула, что в контракте). */
  previewOut: (amount: bigint) => bigint;
  /** Как показать полученное: «12.5 shares». */
  formatOut: (out: bigint) => string;
  /** Если задано — кнопка выключена, текст объясняет почему. */
  blockedReason?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (amount: bigint) => Promise<boolean>;
}

export function ActionForm(p: Props) {
  const [text, setText] = useState("");

  let amount: bigint | null = null;
  let inputError = "";
  if (text.trim()) {
    try {
      amount = parseAmount(text, p.decimals);
      if (amount === 0n) inputError = "Сумма должна быть больше нуля";
      else if (amount > p.max) inputError = `У вас только ${formatAmount(p.max, p.decimals)} ${p.unit}`;
      // контракт откажет (SharesTooSmall / WithdrawTooSmall) — не гоняем пользователя в кошелёк зря
      else if (p.previewOut(amount) === 0n) inputError = "Слишком мало: за эту сумму вы получите 0";
    } catch (e: any) {
      inputError = e.message;
    }
  }
  const ready = amount !== null && !inputError && !p.blockedReason && !p.busy;

  return (
    <form
      className="action"
      onSubmit={async (e) => {
        e.preventDefault();
        if (ready && (await p.onSubmit(amount!))) setText("");
      }}
    >
      <h3>{p.title}</h3>
      <div className="row">
        <input
          inputMode="decimal"
          placeholder={`0 ${p.unit}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!p.blockedReason || p.busy}
          aria-label={`${p.title}: сумма в ${p.unit}`}
        />
        <button
          type="button"
          className="ghost"
          disabled={!!p.blockedReason || p.busy || p.max === 0n}
          onClick={() => setText(formatAmount(p.max, p.decimals))}
        >
          Макс
        </button>
      </div>
      <p className="hint">
        {p.blockedReason ??
          (inputError ? <span className="bad">{inputError}</span> : amount ? `Получите ≈ ${p.formatOut(p.previewOut(amount))}` : `Доступно: ${formatAmount(p.max, p.decimals)} ${p.unit}`)}
      </p>
      <button type="submit" disabled={!ready}>
        {p.busy ? "Ждём подтверждения…" : p.submitLabel}
      </button>
    </form>
  );
}
