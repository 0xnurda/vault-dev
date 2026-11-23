import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { tokenBalance } from "./balance";

const owner = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;

describe("tokenBalance", () => {
  it("аккаунта нет — 0", async () => {
    const connection = { getAccountInfo: async () => null } as any;
    expect(await tokenBalance(connection, owner, mint)).toBe(0n);
  });

  it("RPC ответил ошибкой — ошибка, а не «у вас 0 токенов»", async () => {
    const connection = {
      getAccountInfo: async () => {
        throw new Error("429 Too Many Requests");
      },
    } as any;
    await expect(tokenBalance(connection, owner, mint)).rejects.toThrow(/429/);
  });
});
