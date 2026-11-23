// Те же формулы, что в контракте (lib.rs), для подсказки «сколько получите».
// Деление целочисленное, с округлением вниз — как u128 в Rust.

/** deposit: сколько shares напечатает контракт за `amount` токенов. */
export function previewShares(amount: bigint, totalTokens: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n || totalTokens === 0n) return amount; // первый депозит 1:1
  return (amount * totalShares) / totalTokens;
}

/** withdraw: сколько токенов отдаст контракт за `shares`. */
export function previewWithdraw(shares: bigint, totalTokens: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return 0n;
  return (shares * totalTokens) / totalShares;
}
