use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod instructions;
use instructions::*;

declare_id!("EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu");

// ─────────────────────────────────────────────────────────────────────────────
// Program entry points
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod simple_vault {
    use super::*;

    /// Создать vault для конкретного SPL-токена.
    /// Создаёт: VaultState PDA, vault_token_account PDA, share_mint PDA.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_tokens = 0;
        vault.total_shares = 0;
        vault.bump = ctx.bumps.vault_state;

        msg!("Vault initialized for mint: {}", vault.token_mint);
        Ok(())
    }

    /// Пользователь вносит `amount` токенов → получает shares.
    ///
    /// Формула:
    ///   Первый депозит:       shares = amount  (1:1)
    ///   Последующие депозиты: shares = amount * total_shares / total_tokens
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let vault = &ctx.accounts.vault_state;

        // Рассчитать количество shares
        let shares = if vault.total_shares == 0 || vault.total_tokens == 0 {
            amount // первый депозит: 1 share = 1 token
        } else {
            (amount as u128)
                .checked_mul(vault.total_shares as u128)
                .and_then(|v| v.checked_div(vault.total_tokens as u128))
                .and_then(|v| u64::try_from(v).ok())
                .ok_or(VaultError::MathOverflow)?
        };

        require!(shares > 0, VaultError::SharesTooSmall);

        // 1. CPI: transfer tokens user → vault_token_account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // 2. CPI: mint_to shares → user_share_account
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let seeds = &[b"vault".as_ref(), token_mint_key.as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer,
            ),
            shares,
        )?;

        // 3. Обновить состояние vault
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault.total_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;

        msg!(
            "Deposit: {} tokens → {} shares (total_tokens={}, total_shares={})",
            amount, shares, vault.total_tokens, vault.total_shares
        );
        Ok(())
    }

    /// Пользователь сжигает `shares_amount` shares → получает токены обратно.
    ///
    /// Формула: tokens = shares * total_tokens / total_shares
    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        require!(shares_amount > 0, VaultError::ZeroAmount);

        let vault = &ctx.accounts.vault_state;
        require!(vault.total_shares > 0, VaultError::VaultEmpty);

        // Рассчитать количество токенов к возврату
        let tokens_out = (shares_amount as u128)
            .checked_mul(vault.total_tokens as u128)
            .and_then(|v| v.checked_div(vault.total_shares as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(VaultError::MathOverflow)?;

        require!(tokens_out > 0, VaultError::WithdrawTooSmall);

        // 1. CPI: burn shares from user_share_account
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let seeds = &[b"vault".as_ref(), token_mint_key.as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer = &[&seeds[..]];

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares_amount,
        )?;

        // 2. CPI: transfer tokens vault_token_account → user (подписывает vault PDA)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer,
            ),
            tokens_out,
        )?;

        // 3. Обновить состояние vault
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_sub(tokens_out).ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault.total_shares.checked_sub(shares_amount).ok_or(VaultError::MathOverflow)?;

        msg!(
            "Withdraw: {} shares → {} tokens (total_tokens={}, total_shares={})",
            shares_amount, tokens_out, vault.total_tokens, vault.total_shares
        );
        Ok(())
    }

    /// Закрыть позицию в Raydium CLMM через CPI.
    /// Выводит всю ликвидность обратно в vault, сжигает position NFT.
    pub fn close_raydium_position<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CloseRaydiumPosition<'info>>,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        instructions::close_position::handler(ctx, amount_0_min, amount_1_min)
    }

    /// Открыть позицию в Raydium CLMM через CPI.
    /// Vault PDA = владелец NFT позиции.
    /// Токены берутся из vault_token_account (MyToken) + vault_wsol_account (wSOL).
    pub fn open_raydium_position<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, OpenRaydiumPosition<'info>>,
        tick_lower_index: i32,
        tick_upper_index: i32,
        tick_array_lower_start_index: i32,
        tick_array_upper_start_index: i32,
        liquidity: u128,
        amount_0_max: u64,
        amount_1_max: u64,
    ) -> Result<()> {
        instructions::open_position::handler(
            ctx,
            tick_lower_index,
            tick_upper_index,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
            liquidity,
            amount_0_max,
            amount_1_max,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// VaultState PDA — seeds: ["vault", token_mint]
    #[account(
        init,
        payer = admin,
        space = VaultState::LEN,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Token account, принадлежащий vault PDA — хранит депозиты пользователей
    #[account(
        init,
        payer = admin,
        token::mint = token_mint,
        token::authority = vault_state,
        seeds = [b"vault_tokens", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Mint для shares — выпускается vault PDA
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault_state,
        seeds = [b"share_mint", token_mint.key().as_ref()],
        bump,
    )]
    pub share_mint: Account<'info, Mint>,

    /// SPL-токен, который принимает vault (например, USDC или тестовый токен)
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Vault token account — принимает токены
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — vault чеканит shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (источник токенов)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (получает shares)
    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Vault token account — отправляет токены пользователю
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — сжигает shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (получает токены)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (источник shares для сжигания)
    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct VaultState {
    pub admin: Pubkey,              // 32
    pub token_mint: Pubkey,         // 32  — SPL-токен принимаемый vault'ом
    pub vault_token_account: Pubkey,// 32  — PDA хранящий токены
    pub share_mint: Pubkey,         // 32  — mint для shares
    pub total_tokens: u64,          // 8   — всего токенов в vault
    pub total_shares: u64,          // 8   — всего выпущенных shares
    pub bump: u8,                   // 1   — bump vault PDA
}

impl VaultState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Shares would be zero — deposit too small")]
    SharesTooSmall,
    #[msg("Withdraw amount too small")]
    WithdrawTooSmall,
    #[msg("Vault is empty")]
    VaultEmpty,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized: only admin can call this")]
    Unauthorized,
    #[msg("tick_lower must be less than tick_upper")]
    InvalidTickRange,
}
