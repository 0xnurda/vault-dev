use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu");

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

    /// Создать личную «карточку» пользователя в vault.
    /// У каждого пользователя ровно одна карточка (PDA от vault + user).
    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        let card = &mut ctx.accounts.user_card;
        card.vault = ctx.accounts.vault_state.key();
        card.owner = ctx.accounts.user.key();
        card.bump = ctx.bumps.user_card;

        msg!("User card created for: {}", card.owner);
        Ok(())
    }

    /// Пользователь вносит `amount` токенов → получает share-токены.
    ///
    /// Формула:
    ///   Первый депозит:       shares = amount  (1:1)
    ///   Последующие депозиты: shares = amount * total_shares / total_tokens
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let vault = &ctx.accounts.vault_state;

        // Сколько shares получит пользователь
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

        // 1. Переводим токены: пользователь → vault
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

        // 2. Печатаем shares пользователю (подписывает vault PDA)
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let seeds = &[
            b"vault".as_ref(),
            token_mint_key.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ];
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

        // 3. Обновляем vault и карточку пользователя
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault.total_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;

        let card = &mut ctx.accounts.user_card;
        card.deposited = card.deposited.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        card.shares = card.shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;

        msg!(
            "Deposit: {} tokens -> {} shares (total_tokens={}, total_shares={})",
            amount, shares, vault.total_tokens, vault.total_shares
        );
        Ok(())
    }

    /// Пользователь возвращает `shares_amount` share-токенов → забирает свои токены.
    ///
    /// Формула: tokens = shares * total_tokens / total_shares
    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        require!(shares_amount > 0, VaultError::ZeroAmount);

        let vault = &ctx.accounts.vault_state;
        require!(vault.total_shares > 0, VaultError::VaultEmpty);

        // Сколько токенов положено за эти shares
        let tokens_out = (shares_amount as u128)
            .checked_mul(vault.total_tokens as u128)
            .and_then(|v| v.checked_div(vault.total_shares as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(VaultError::MathOverflow)?;
        require!(tokens_out > 0, VaultError::WithdrawTooSmall);

        // 1. Сжигаем shares пользователя (подписывает сам пользователь)
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

        // 2. Отправляем токены: vault → пользователь (подписывает vault PDA)
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let seeds = &[
            b"vault".as_ref(),
            token_mint_key.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ];
        let signer = &[&seeds[..]];

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

        // 3. Обновляем vault и карточку пользователя
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_sub(tokens_out).ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault.total_shares.checked_sub(shares_amount).ok_or(VaultError::MathOverflow)?;

        // saturating: shares можно передать другому кошельку, тогда в карточке их может быть меньше
        let card = &mut ctx.accounts.user_card;
        card.deposited = card.deposited.saturating_sub(tokens_out);
        card.shares = card.shares.saturating_sub(shares_amount);

        msg!(
            "Withdraw: {} shares -> {} tokens (total_tokens={}, total_shares={})",
            shares_amount, tokens_out, vault.total_tokens, vault.total_shares
        );
        Ok(())
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

    /// Token account, принадлежащий vault PDA
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

    /// SPL-токен, который принимает vault
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// UserCard PDA — seeds: ["user_card", vault_state, user]
    #[account(
        init,
        payer = user,
        space = UserCard::LEN,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Карточка пользователя — депозит возможен только после create_user_card
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    /// Токен-аккаунт vault — принимает токены
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — vault печатает shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (откуда списываем токены)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (куда придут shares)
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

    /// Карточка пользователя — вывод возможен только с карточкой
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    /// Токен-аккаунт vault — отправляет токены пользователю
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — тут сжигаются shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (куда придут токены)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (откуда сжигаем shares)
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
    pub admin: Pubkey,               // 32
    pub token_mint: Pubkey,          // 32 — SPL-токен vault'а
    pub vault_token_account: Pubkey, // 32 — PDA для токенов
    pub share_mint: Pubkey,          // 32 — mint для shares
    pub total_tokens: u64,           // 8  — всего токенов в vault
    pub total_shares: u64,           // 8  — всего выпущено shares
    pub bump: u8,                    // 1
}

impl VaultState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1;
}

/// Карточка пользователя в vault.
#[account]
#[derive(Default)]
pub struct UserCard {
    pub vault: Pubkey, // 32 — к какому vault относится
    pub owner: Pubkey, // 32 — владелец карточки
    pub deposited: u64, // 8 — сколько токенов внёс пользователь
    pub shares: u64,    // 8 — сколько shares у пользователя
    pub bump: u8,      // 1
}

impl UserCard {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Shares would be zero - deposit too small")]
    SharesTooSmall,
    #[msg("Vault is empty")]
    VaultEmpty,
    #[msg("Withdraw amount too small")]
    WithdrawTooSmall,
    #[msg("Math overflow")]
    MathOverflow,
}
