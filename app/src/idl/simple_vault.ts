/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/simple_vault.json`.
 */
export type SimpleVault = {
  "address": "EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu",
  "metadata": {
    "name": "simpleVault",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "addPairToken",
      "docs": [
        "Админ заводит vault второй токен пары (TOKEN_B пула)."
      ],
      "discriminator": [
        224,
        145,
        52,
        153,
        167,
        94,
        18,
        90
      ],
      "accounts": [
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenMintB",
          "docs": [
            "Второй токен пары (TOKEN_B)"
          ]
        },
        {
          "name": "vaultTokenAccountB",
          "docs": [
            "Токен-аккаунт vault для TOKEN_B — seeds: [\"vault_tokens_b\", token_mint]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closePosition",
      "docs": [
        "Неделя 13. Админ закрывает позицию: всё возвращается в vault."
      ],
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "mut: при close_position админу возвращается рента, которую он платил в open_position"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "writable": true
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "positionNftMint",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "vault0Mint"
        },
        {
          "name": "vault1Mint"
        },
        {
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenProgram2022",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount0Min",
          "type": "u64"
        },
        {
          "name": "amount1Min",
          "type": "u64"
        }
      ]
    },
    {
      "name": "collectFees",
      "docs": [
        "Неделя 13. Админ забирает накопленные комиссии позиции в vault."
      ],
      "discriminator": [
        164,
        152,
        207,
        99,
        30,
        186,
        19,
        182
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "mut: при close_position админу возвращается рента, которую он платил в open_position"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "writable": true
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "positionNftMint",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "vault0Mint"
        },
        {
          "name": "vault1Mint"
        },
        {
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenProgram2022",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createUserCard",
      "docs": [
        "Создать личную «карточку» пользователя в vault.",
        "У каждого пользователя ровно одна карточка (PDA от vault + user)."
      ],
      "discriminator": [
        25,
        67,
        231,
        22,
        28,
        170,
        76,
        39
      ],
      "accounts": [
        {
          "name": "vaultState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "userCard",
          "docs": [
            "UserCard PDA — seeds: [\"user_card\", vault_state, user]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Пользователь вносит `amount` токенов → получает share-токены.",
        "",
        "Формула:",
        "Первый депозит:       shares = amount  (1:1)",
        "Последующие депозиты: shares = amount * total_shares / total_tokens"
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "userCard",
          "docs": [
            "Карточка пользователя — депозит возможен только после create_user_card"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "Токен-аккаунт vault — принимает токены"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "docs": [
            "Share mint — vault печатает shares"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "Токен-аккаунт пользователя (откуда списываем токены)"
          ],
          "writable": true
        },
        {
          "name": "userShareAccount",
          "docs": [
            "Share-аккаунт пользователя (куда придут shares)"
          ],
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeVault",
      "docs": [
        "Создать vault для конкретного SPL-токена.",
        "Создаёт: VaultState PDA, vault_token_account PDA, share_mint PDA."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "vaultState",
          "docs": [
            "VaultState PDA — seeds: [\"vault\", token_mint]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "Token account, принадлежащий vault PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "docs": [
            "Mint для shares — выпускается vault PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "SPL-токен, который принимает vault"
          ]
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openPosition",
      "docs": [
        "Неделя 13. Админ открывает позицию vault в ценовом диапазоне."
      ],
      "discriminator": [
        135,
        128,
        47,
        77,
        15,
        152,
        240,
        49
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Админ платит ренту за NFT позиции и служебные аккаунты Raydium"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "writable": true
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "positionNftMint",
          "docs": [
            "Новый mint NFT позиции (свежий keypair с клиента)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "vault0Mint"
        },
        {
          "name": "vault1Mint"
        },
        {
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram2022",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "tickLowerIndex",
          "type": "i32"
        },
        {
          "name": "tickUpperIndex",
          "type": "i32"
        },
        {
          "name": "tickArrayLowerStartIndex",
          "type": "i32"
        },
        {
          "name": "tickArrayUpperStartIndex",
          "type": "i32"
        },
        {
          "name": "amount0Max",
          "type": "u64"
        },
        {
          "name": "amount1Max",
          "type": "u64"
        },
        {
          "name": "base0",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swap",
      "docs": [
        "Неделя 12. Админ обменивает токены vault через пул Raydium."
      ],
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "Токены vault: TOKEN_A"
          ],
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "docs": [
            "Токены vault: TOKEN_B"
          ],
          "writable": true
        },
        {
          "name": "ammConfig"
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "inputVault",
          "writable": true
        },
        {
          "name": "outputVault",
          "writable": true
        },
        {
          "name": "observationState",
          "writable": true
        },
        {
          "name": "inputVaultMint"
        },
        {
          "name": "outputVaultMint"
        },
        {
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenProgram2022",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        },
        {
          "name": "aToB",
          "type": "bool"
        }
      ]
    },
    {
      "name": "syncVault",
      "docs": [
        "Вернуть vault в обычный режим, когда всё снова в TOKEN_A."
      ],
      "discriminator": [
        19,
        211,
        150,
        118,
        94,
        208,
        138,
        204
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount"
        },
        {
          "name": "vaultTokenAccountB"
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Пользователь возвращает `shares_amount` share-токенов → забирает свои токены.",
        "",
        "Формула: tokens = shares * total_tokens / total_shares"
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "vaultState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "userCard",
          "docs": [
            "Карточка пользователя — вывод возможен только с карточкой"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "Токен-аккаунт vault — отправляет токены пользователю"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "docs": [
            "Share mint — тут сжигаются shares"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.token_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "Токен-аккаунт пользователя (куда придут токены)"
          ],
          "writable": true
        },
        {
          "name": "userShareAccount",
          "docs": [
            "Share-аккаунт пользователя (откуда сжигаем shares)"
          ],
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sharesAmount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "personalPositionState",
      "discriminator": [
        70,
        111,
        150,
        126,
        230,
        15,
        25,
        117
      ]
    },
    {
      "name": "poolState",
      "discriminator": [
        247,
        237,
        227,
        245,
        215,
        195,
        222,
        70
      ]
    },
    {
      "name": "userCard",
      "discriminator": [
        99,
        156,
        133,
        85,
        192,
        58,
        202,
        10
      ]
    },
    {
      "name": "vaultState",
      "discriminator": [
        228,
        196,
        82,
        165,
        98,
        210,
        235,
        152
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "sharesTooSmall",
      "msg": "Shares would be zero - deposit too small"
    },
    {
      "code": 6002,
      "name": "vaultEmpty",
      "msg": "Vault is empty"
    },
    {
      "code": 6003,
      "name": "withdrawTooSmall",
      "msg": "Withdraw amount too small"
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "Unauthorized: only admin can call this"
    },
    {
      "code": 6006,
      "name": "inMarket",
      "msg": "Vault funds are in the market: deposit/withdraw paused until sync_vault"
    },
    {
      "code": 6007,
      "name": "pairNotSet",
      "msg": "Pair token (TOKEN_B) is not set: call add_pair_token"
    },
    {
      "code": 6008,
      "name": "sameToken",
      "msg": "Pair token must differ from vault token"
    },
    {
      "code": 6009,
      "name": "wrongPool",
      "msg": "Pool does not match vault token pair"
    },
    {
      "code": 6010,
      "name": "invalidTickRange",
      "msg": "tick_lower must be less than tick_upper"
    },
    {
      "code": 6011,
      "name": "positionAlreadyOpen",
      "msg": "Position is already open"
    },
    {
      "code": 6012,
      "name": "noOpenPosition",
      "msg": "No open position"
    },
    {
      "code": 6013,
      "name": "positionOpen",
      "msg": "Cannot sync: position is still open, call close_position first"
    },
    {
      "code": 6014,
      "name": "tokenBNotZero",
      "msg": "Cannot sync: vault still holds TOKEN_B, swap it back to TOKEN_A first"
    }
  ],
  "types": [
    {
      "name": "personalPositionState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "Bump to identify PDA"
            ],
            "type": "u8"
          },
          {
            "name": "nftMint",
            "docs": [
              "Mint address of the tokenized position"
            ],
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "docs": [
              "The ID of the pool with which this token is connected"
            ],
            "type": "pubkey"
          },
          {
            "name": "tickLowerIndex",
            "docs": [
              "The lower bound tick of the position"
            ],
            "type": "i32"
          },
          {
            "name": "tickUpperIndex",
            "docs": [
              "The upper bound tick of the position"
            ],
            "type": "i32"
          },
          {
            "name": "liquidity",
            "docs": [
              "The amount of liquidity owned by this position"
            ],
            "type": "u128"
          },
          {
            "name": "feeGrowthInside0LastX64",
            "docs": [
              "The token_0 fee growth of the aggregate position as of the last action on the individual position"
            ],
            "type": "u128"
          },
          {
            "name": "feeGrowthInside1LastX64",
            "docs": [
              "The token_1 fee growth of the aggregate position as of the last action on the individual position"
            ],
            "type": "u128"
          },
          {
            "name": "tokenFeesOwed0",
            "docs": [
              "The fees owed to the position owner in token_0, as of the last computation"
            ],
            "type": "u64"
          },
          {
            "name": "tokenFeesOwed1",
            "docs": [
              "The fees owed to the position owner in token_1, as of the last computation"
            ],
            "type": "u64"
          },
          {
            "name": "rewardInfos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "positionRewardInfo"
                  }
                },
                3
              ]
            }
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolState",
      "docs": [
        "The pool state",
        "",
        "PDA of `[POOL_SEED, config, token_mint_0, token_mint_1]`",
        ""
      ],
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "Bump to identify PDA"
            ],
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "ammConfig",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "tokenMint0",
            "docs": [
              "Token pair of the pool, where token_mint_0 address < token_mint_1 address"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint1",
            "type": "pubkey"
          },
          {
            "name": "tokenVault0",
            "docs": [
              "Token pair vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenVault1",
            "type": "pubkey"
          },
          {
            "name": "observationKey",
            "docs": [
              "observation account key"
            ],
            "type": "pubkey"
          },
          {
            "name": "mintDecimals0",
            "docs": [
              "mint0 and mint1 decimals"
            ],
            "type": "u8"
          },
          {
            "name": "mintDecimals1",
            "type": "u8"
          },
          {
            "name": "tickSpacing",
            "docs": [
              "The minimum number of ticks between initialized ticks"
            ],
            "type": "u16"
          },
          {
            "name": "liquidity",
            "docs": [
              "The currently in range liquidity available to the pool."
            ],
            "type": "u128"
          },
          {
            "name": "sqrtPriceX64",
            "docs": [
              "The current price of the pool as a sqrt(token_1/token_0) Q64.64 value"
            ],
            "type": "u128"
          },
          {
            "name": "tickCurrent",
            "docs": [
              "The current tick of the pool, i.e. according to the last tick transition that was run."
            ],
            "type": "i32"
          },
          {
            "name": "observationIndex",
            "docs": [
              "the most-recently updated index of the observations array"
            ],
            "type": "u16"
          },
          {
            "name": "observationUpdateDuration",
            "type": "u16"
          },
          {
            "name": "feeGrowthGlobal0X64",
            "docs": [
              "The fee growth as a Q64.64 number, i.e. fees of token_0 and token_1 collected per",
              "unit of liquidity for the entire life of the pool."
            ],
            "type": "u128"
          },
          {
            "name": "feeGrowthGlobal1X64",
            "type": "u128"
          },
          {
            "name": "protocolFeesToken0",
            "docs": [
              "The amounts of token_0 and token_1 that are owed to the protocol."
            ],
            "type": "u64"
          },
          {
            "name": "protocolFeesToken1",
            "type": "u64"
          },
          {
            "name": "swapInAmountToken0",
            "docs": [
              "The amounts in and out of swap token_0 and token_1"
            ],
            "type": "u128"
          },
          {
            "name": "swapOutAmountToken1",
            "type": "u128"
          },
          {
            "name": "swapInAmountToken1",
            "type": "u128"
          },
          {
            "name": "swapOutAmountToken0",
            "type": "u128"
          },
          {
            "name": "status",
            "docs": [
              "Bitwise representation of the state of the pool",
              "bit0, 1: disable open position and increase liquidity, 0: normal",
              "bit1, 1: disable decrease liquidity, 0: normal",
              "bit2, 1: disable collect fee, 0: normal",
              "bit3, 1: disable collect reward, 0: normal",
              "bit4, 1: disable swap, 0: normal"
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "docs": [
              "Leave blank for future use"
            ],
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "rewardInfos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "rewardInfo"
                  }
                },
                3
              ]
            }
          },
          {
            "name": "tickArrayBitmap",
            "docs": [
              "Packed initialized tick array state"
            ],
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "totalFeesToken0",
            "docs": [
              "except protocol_fee and fund_fee"
            ],
            "type": "u64"
          },
          {
            "name": "totalFeesClaimedToken0",
            "docs": [
              "except protocol_fee and fund_fee"
            ],
            "type": "u64"
          },
          {
            "name": "totalFeesToken1",
            "type": "u64"
          },
          {
            "name": "totalFeesClaimedToken1",
            "type": "u64"
          },
          {
            "name": "fundFeesToken0",
            "type": "u64"
          },
          {
            "name": "fundFeesToken1",
            "type": "u64"
          },
          {
            "name": "openTime",
            "type": "u64"
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u64",
                25
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionRewardInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "growthInsideLastX64",
            "type": "u128"
          },
          {
            "name": "rewardAmountOwed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rewardInfo",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rewardState",
            "docs": [
              "Reward state"
            ],
            "type": "u8"
          },
          {
            "name": "openTime",
            "docs": [
              "Reward open time"
            ],
            "type": "u64"
          },
          {
            "name": "endTime",
            "docs": [
              "Reward end time"
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateTime",
            "docs": [
              "Reward last update time"
            ],
            "type": "u64"
          },
          {
            "name": "emissionsPerSecondX64",
            "docs": [
              "Q64.64 number indicates how many tokens per second are earned per unit of liquidity."
            ],
            "type": "u128"
          },
          {
            "name": "rewardTotalEmissioned",
            "docs": [
              "The total amount of reward emissioned"
            ],
            "type": "u64"
          },
          {
            "name": "rewardClaimed",
            "docs": [
              "The total amount of claimed reward"
            ],
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "docs": [
              "Reward token mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenVault",
            "docs": [
              "Reward vault token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "The owner that has permission to set reward param"
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardGrowthGlobalX64",
            "docs": [
              "Q64.64 number that tracks the total tokens earned per unit of liquidity since the reward",
              "emissions were turned on."
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "userCard",
      "docs": [
        "Карточка пользователя в vault."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "vaultTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "totalTokens",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "vaultTokenAccountB",
            "type": "pubkey"
          },
          {
            "name": "positionNftMint",
            "type": "pubkey"
          },
          {
            "name": "inMarket",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
