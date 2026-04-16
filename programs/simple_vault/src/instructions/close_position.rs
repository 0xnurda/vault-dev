use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use raydium_clmm_cpi::{
    cpi,
    states::{PersonalPositionState, PoolState, TickArrayState},
};

use crate::VaultState;

/// Закрыть позицию в Raydium CLMM через CPI.
///
/// Поток:
///   1. decrease_liquidity_v2 — возвращает токены в vault_token_account / vault_wsol_account
///   2. close_position — сжигает position NFT
#[derive(Accounts)]
pub struct CloseRaydiumPosition<'info> {
    /// Admin — авторизован закрыть позицию
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Vault PDA
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ crate::VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Vault token account (MyToken) — получит MyToken обратно
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// wSOL account vault PDA — получит wSOL обратно
    #[account(
        mut,
        token::mint = wsol_mint,
        token::authority = vault_state,
    )]
    pub vault_wsol_account: InterfaceAccount<'info, TokenAccount>,

    pub wsol_mint: InterfaceAccount<'info, Mint>,

    // ─── Raydium CLMM аккаунты ────────────────────────────────────────────

    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,

    /// Position NFT mint (Token2022)
    #[account(mut)]
    pub position_nft_mint: Box<InterfaceAccount<'info, Mint>>,

    /// ATA позиции — принадлежит vault_state (Token2022)
    #[account(
        mut,
        token::mint = position_nft_mint,
        token::authority = vault_state,
    )]
    pub position_nft_account: InterfaceAccount<'info, TokenAccount>,

    /// Personal position state (Raydium)
    #[account(
        mut,
        constraint = personal_position.pool_id == pool_state.key(),
    )]
    pub personal_position: Box<Account<'info, PersonalPositionState>>,

    /// Vault пула для token0
    #[account(mut)]
    pub token_vault_0: InterfaceAccount<'info, TokenAccount>,

    /// Vault пула для token1
    #[account(mut)]
    pub token_vault_1: InterfaceAccount<'info, TokenAccount>,

    /// Tick array нижней границы позиции
    #[account(mut)]
    pub tick_array_lower: AccountLoader<'info, TickArrayState>,

    /// Tick array верхней границы позиции
    #[account(mut)]
    pub tick_array_upper: AccountLoader<'info, TickArrayState>,

    pub vault_0_mint: InterfaceAccount<'info, Mint>,
    pub vault_1_mint: InterfaceAccount<'info, Mint>,

    /// Raydium CLMM program
    /// CHECK: проверяется через address = raydium_clmm_cpi::id()
    #[account(address = raydium_clmm_cpi::id())]
    pub clmm_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'a, 'b, 'c: 'info, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CloseRaydiumPosition<'info>>,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    // Собрать remaining_accounts до любых заимствований из ctx
    let remaining = ctx.remaining_accounts.to_vec();

    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let vault_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

    // Читаем ликвидность из personal_position
    let liquidity = ctx.accounts.personal_position.liquidity;

    // Определяем порядок токенов (какой account получает token0, какой token1)
    let my_token_mint = ctx.accounts.vault_state.token_mint;
    let pool_mint_0 = ctx.accounts.vault_0_mint.key();
    let (recipient_0, recipient_1) = if pool_mint_0 == my_token_mint {
        (
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.vault_wsol_account.to_account_info(),
        )
    } else {
        (
            ctx.accounts.vault_wsol_account.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
        )
    };

    // 1. Вывести всю ликвидность (если есть)
    if liquidity > 0 {
        let decrease_accounts = cpi::accounts::DecreaseLiquidityV2 {
            nft_owner: ctx.accounts.vault_state.to_account_info(),
            nft_account: ctx.accounts.position_nft_account.to_account_info(),
            personal_position: ctx.accounts.personal_position.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            protocol_position: ctx.accounts.personal_position.to_account_info(),
            token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
            tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
            tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
            recipient_token_account_0: recipient_0,
            recipient_token_account_1: recipient_1,
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
            vault_0_mint: ctx.accounts.vault_0_mint.to_account_info(),
            vault_1_mint: ctx.accounts.vault_1_mint.to_account_info(),
        };

        let decrease_ctx = CpiContext::new_with_signer(
            ctx.accounts.clmm_program.to_account_info(),
            decrease_accounts,
            vault_seeds,
        )
        .with_remaining_accounts(remaining);

        cpi::decrease_liquidity_v2(decrease_ctx, liquidity, amount_0_min, amount_1_min)?;
    }

    // 2. Закрыть позицию (сжечь NFT)
    let close_accounts = cpi::accounts::ClosePosition {
        nft_owner: ctx.accounts.vault_state.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program_2022.to_account_info(),
    };

    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.clmm_program.to_account_info(),
        close_accounts,
        vault_seeds,
    );

    cpi::close_position(close_ctx)?;

    msg!("Position closed: liquidity={}", liquidity);
    Ok(())
}
