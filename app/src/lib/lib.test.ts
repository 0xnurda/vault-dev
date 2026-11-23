import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "./amount";
import { previewShares, previewWithdraw } from "./math";
import { anchorErrorName, describeError } from "./errors";

describe("parseAmount", () => {
  it("переводит в минимальные единицы, запятая = точка", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("1,5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("7", 6)).toBe(7_000_000n);
  });

  it("не теряет точность на больших суммах (float бы округлил)", () => {
    // 9007199254.740993 * 1e6 = 2^53 + 1 — ближайший float-ответ 2^53
    expect(parseAmount("9007199254.740993", 6)).toBe(9_007_199_254_740_993n);
  });

  it("отклоняет лишние знаки и мусор", () => {
    expect(() => parseAmount("1.0000001", 6)).toThrow();
    expect(() => parseAmount("-1", 6)).toThrow();
    expect(() => parseAmount("1e3", 6)).toThrow();
    expect(() => parseAmount("", 6)).toThrow();
    expect(() => parseAmount("1.", 6)).toThrow();
  });
});

describe("formatAmount", () => {
  it("убирает лишние нули и не теряет мелочь", () => {
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(1n, 6)).toBe("0.000001");
    expect(formatAmount(7_000_000n, 6)).toBe("7");
    expect(formatAmount(0n, 6)).toBe("0");
    expect(formatAmount(9_007_199_254_740_993n, 6)).toBe("9007199254.740993");
  });
});

describe("previewShares — та же формула, что deposit в lib.rs", () => {
  it("первый депозит 1:1", () => {
    expect(previewShares(250n, 0n, 0n)).toBe(250n);
  });

  it("shares есть, а токенов 0 — контракт тоже даёт 1:1", () => {
    expect(previewShares(250n, 0n, 100n)).toBe(250n);
  });

  it("делит с округлением вниз: 2 * 2 / 3 = 1, а не 1.33 и не 2", () => {
    expect(previewShares(2n, 3n, 2n)).toBe(1n);
  });

  it("после прибыли vault за те же токены выходит меньше shares", () => {
    // в vault 1100 токенов на 1000 shares: 110 токенов → 100 shares
    expect(previewShares(110n, 1100n, 1000n)).toBe(100n);
  });
});

describe("previewWithdraw — та же формула, что withdraw в lib.rs", () => {
  it("делит с округлением вниз: 2 * 2 / 3 = 1", () => {
    expect(previewWithdraw(2n, 2n, 3n)).toBe(1n);
  });

  it("после прибыли за shares выходит больше токенов", () => {
    expect(previewWithdraw(100n, 1100n, 1000n)).toBe(110n);
  });

  it("пустой vault — 0", () => {
    expect(previewWithdraw(5n, 0n, 0n)).toBe(0n);
  });
});

describe("describeError", () => {
  it("имя ошибки Anchor из AnchorError и из логов", () => {
    expect(anchorErrorName({ error: { errorCode: { code: "InMarket", number: 6006 } } })).toBe("InMarket");
    expect(
      anchorErrorName({ message: "x", logs: ["Program log: AnchorError ... Error Code: ZeroAmount. Error Number: 6000."] })
    ).toBe("ZeroAmount");
  });

  it("InMarket объясняет паузу, а не показывает код", () => {
    expect(describeError({ error: { errorCode: { code: "InMarket" } } })).toMatch(/в рынке/);
  });

  it("неизвестная ошибка контракта показывает её имя", () => {
    expect(describeError({ error: { errorCode: { code: "WrongPool" } } })).toMatch(/WrongPool/);
  });

  it("отмена в кошельке", () => {
    expect(describeError({ code: 4001, message: "User rejected the request." })).toMatch(/отменили/);
  });

  it("нет SOL на комиссию", () => {
    expect(
      describeError({ message: "Simulation failed: Attempt to debit an account but found no record of a prior credit." })
    ).toMatch(/SOL/);
  });

  it("лимит RPC", () => {
    expect(describeError({ message: "429 Too Many Requests" })).toMatch(/лимит/);
  });

  it("не дождались подтверждения — предупреждает, что транзакция могла пройти", () => {
    const text = describeError({
      message: "Transaction was not confirmed in 30.00 seconds. It is unknown if it succeeded or failed.",
    });
    expect(text).toMatch(/могла пройти/);
    expect(text).not.toMatch(/Попробуйте ещё раз/);
  });

  it("таймаут, в подписи которого есть «429», — всё равно «могла пройти», а не лимит RPC", () => {
    const text = describeError({
      message:
        "Transaction was not confirmed in 30.00 seconds. It is unknown if it succeeded or failed. " +
        "Check signature 3wGx429LTg6crH7XjjV4 using the Solana Explorer or CLI tools.",
    });
    expect(text).toMatch(/могла пройти/);
  });

  it("«429» в логах (compute units) — не лимит RPC", () => {
    const text = describeError({ message: "failed", logs: ["Program X consumed 14293 of 200000 compute units"] });
    expect(text).not.toMatch(/лимит/);
  });

  it("истёк blockhash — можно повторить", () => {
    expect(describeError({ message: "Blockhash not found" })).toMatch(/ещё раз/);
  });

  it("ошибка с пустым message не даёт пустой текст", () => {
    expect(describeError({ name: "TokenOwnerOffCurveError", message: "" })).toBe("TokenOwnerOffCurveError");
    expect(describeError({ name: "TokenAccountNotFoundError", message: "" })).toMatch(/vault-config/);
  });

  it("0x1 токен-программы — не хватает токенов, а 0x10 — нет", () => {
    expect(describeError({ message: "failed: custom program error: 0x1" })).toMatch(/токенов/);
    expect(describeError({ message: "failed: custom program error: 0x10" })).not.toMatch(/токенов/);
  });
});
