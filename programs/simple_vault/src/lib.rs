use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("EpM7JMw19rcwizaARbUgrL2Z6cvv6EMTh9KqJk2iWsEe");

/// Минимальный депозит (в минимальных единицах токена).
pub const MIN_DEPOSIT: u64 = 100;
/// Комиссия на депозит, в процентах.
pub const FEE_PERCENT: u64 = 1;

#[program]
pub mod simple_vault {
    use super::*;

    /// Админ создаёт vault для SPL-токена.
    /// `fee_wallet` — владелец токен-аккаунта, куда уходит комиссия.
    pub fn initialize_vault(ctx: Context<InitializeVault>, fee_wallet: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.fee_wallet = fee_wallet;
        vault.total_tokens = 0;
        vault.total_shares = 0;
        vault.paused = false;
        vault.bump = ctx.bumps.vault_state;

        msg!("Vault initialized for mint: {}", vault.token_mint);
        Ok(())
    }

    /// Пользователь создаёт личную карточку в vault.
    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

        let card = &mut ctx.accounts.user_card;
        card.vault = ctx.accounts.vault_state.key();
        card.owner = ctx.accounts.user.key();
        card.deposited = 0;
        card.shares = 0;
        card.created_at = Clock::get()?.unix_timestamp;
        card.bump = ctx.bumps.user_card;

        msg!("User card created for: {}", card.owner);
        Ok(())
    }

    /// Закрыть карточку (только если shares = 0). Рента возвращается владельцу.
    pub fn close_user_card(ctx: Context<CloseUserCard>) -> Result<()> {
        require!(ctx.accounts.user_card.shares == 0, VaultError::CardHasShares);
        msg!("User card closed for: {}", ctx.accounts.user.key());
        Ok(())
    }

    /// Админ ставит vault на паузу / снимает с паузы.
    /// Пауза блокирует депозиты и создание карточек, вывод остаётся доступным.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.paused = paused;
        msg!("Vault paused = {}", paused);
        Ok(())
    }

    /// Пользователь вносит `amount` токенов:
    /// 1% уходит на fee_wallet, остальное в vault, пользователь получает shares.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(!vault.paused, VaultError::VaultPaused);
        require!(amount > 0, VaultError::ZeroAmount);
        require!(amount >= MIN_DEPOSIT, VaultError::DepositTooSmall);

        // Комиссия
        let fee_amount = amount
            .checked_mul(FEE_PERCENT)
            .and_then(|v| v.checked_div(100))
            .ok_or(VaultError::MathOverflow)?;

        let deposit_amount = amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;
        require!(deposit_amount > 0, VaultError::DepositTooSmall);

        // Сколько shares получит пользователь
        let shares = if vault.total_shares == 0 || vault.total_tokens == 0 {
            deposit_amount // первый депозит: 1 share = 1 token
        } else {
            (deposit_amount as u128)
                .checked_mul(vault.total_shares as u128)
                .and_then(|v| v.checked_div(vault.total_tokens as u128))
                .and_then(|v| u64::try_from(v).ok())
                .ok_or(VaultError::MathOverflow)?
        };
        require!(shares > 0, VaultError::SharesTooSmall);

        // 1. Комиссия: пользователь -> fee_token_account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            fee_amount,
        )?;

        // 2. Остальное: пользователь -> vault_token_account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            deposit_amount,
        )?;

        // 3. Печатаем shares (подписывает vault PDA)
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

        // 4. Обновляем vault и карточку
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault
            .total_tokens
            .checked_add(deposit_amount)
            .ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares)
            .ok_or(VaultError::MathOverflow)?;

        let card = &mut ctx.accounts.user_card;
        card.deposited = card
            .deposited
            .checked_add(deposit_amount)
            .ok_or(VaultError::MathOverflow)?;
        card.shares = card
            .shares
            .checked_add(shares)
            .ok_or(VaultError::MathOverflow)?;

        msg!(
            "Deposit: {} total -> {} to vault ({} fee) -> {} shares",
            amount,
            deposit_amount,
            fee_amount,
            shares
        );
        Ok(())
    }

    /// Пользователь возвращает `shares_amount` shares и забирает свои токены.
    /// Формула: tokens = shares_amount * total_tokens / total_shares
    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        require!(shares_amount > 0, VaultError::ZeroAmount);

        let vault = &ctx.accounts.vault_state;
        require!(vault.total_shares > 0, VaultError::VaultEmpty);

        // Сколько токенов положено за эти shares
        let tokens = (shares_amount as u128)
            .checked_mul(vault.total_tokens as u128)
            .and_then(|v| v.checked_div(vault.total_shares as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(VaultError::MathOverflow)?;
        require!(tokens > 0, VaultError::WithdrawTooSmall);

        // 1. CPI burn: сжигаем shares пользователя (подписывает пользователь)
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

        // 2. CPI transfer: токены из vault -> пользователю (подписывает vault PDA)
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
            tokens,
        )?;

        // 3. Обновляем vault и карточку
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault
            .total_tokens
            .checked_sub(tokens)
            .ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_sub(shares_amount)
            .ok_or(VaultError::MathOverflow)?;

        let card = &mut ctx.accounts.user_card;
        card.deposited = card.deposited.saturating_sub(tokens);
        card.shares = card.shares.saturating_sub(shares_amount);

        msg!("Withdraw: {} shares -> {} tokens", shares_amount, tokens);
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault_tokens", token_mint.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [b"share_mint", token_mint.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = user,
        space = 8 + UserCard::INIT_SPACE,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        close = user,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::NotAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Депозит возможен только после create_user_card
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт fee_wallet — получает комиссию
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = vault_state.fee_wallet,
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

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

    /// Вывод возможен только с карточкой
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

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
#[derive(InitSpace)]
pub struct VaultState {
    pub admin: Pubkey,               // кто создал vault
    pub token_mint: Pubkey,          // SPL-токен vault'а
    pub vault_token_account: Pubkey, // токен-аккаунт vault
    pub share_mint: Pubkey,          // mint для shares
    pub fee_wallet: Pubkey,          // владелец аккаунта комиссии
    pub total_tokens: u64,           // всего токенов в vault
    pub total_shares: u64,           // всего выпущено shares
    pub paused: bool,                // пауза депозитов
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserCard {
    pub vault: Pubkey,   // к какому vault относится
    pub owner: Pubkey,   // владелец карточки
    pub deposited: u64,  // сколько токенов пользователь сейчас держит в vault
    pub shares: u64,     // сколько shares у пользователя
    pub created_at: i64, // unix timestamp создания
    pub bump: u8,
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
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Deposit is below the minimum")]
    DepositTooSmall,
    #[msg("Vault has no shares")]
    VaultEmpty,
    #[msg("Withdraw too small - would return zero tokens")]
    WithdrawTooSmall,
    #[msg("Card still has shares - withdraw first")]
    CardHasShares,
    #[msg("Only admin can do this")]
    NotAdmin,
}