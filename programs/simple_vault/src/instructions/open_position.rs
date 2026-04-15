use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Approve, Mint, Revoke, TokenAccount};
use raydium_clmm_cpi::{cpi, states::PoolState};

use crate::VaultState;

/// Открыть позицию в Raydium CLMM через CPI.
///
/// Поток:
///   TypeScript → vault::open_raydium_position → Raydium CLMM CPI
///
/// Vault PDA выступает position_nft_owner (владелец позиции).
/// Токены берутся из vault_token_account (MyToken) и wsol_account (wSOL) — оба
/// принадлежат vault PDA, поэтому vault PDA подписывает CPI.
#[derive(Accounts)]
pub struct OpenRaydiumPosition<'info> {
    /// Admin — платит rent за position NFT и tick arrays
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Vault PDA — авторизация + владелец NFT позиции
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ crate::VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Vault token account (MyToken) — token0 или token1 в зависимости от пула
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// wSOL account принадлежащий vault PDA (создаётся перед вызовом)
    /// CHECK: проверяется через token::mint = wsol_mint, token::authority = vault_state
    #[account(
        mut,
        token::mint = wsol_mint,
        token::authority = vault_state,
    )]
    pub vault_wsol_account: InterfaceAccount<'info, TokenAccount>,

    /// wSOL mint: So11111111111111111111111111111111111111112
    pub wsol_mint: InterfaceAccount<'info, Mint>,

    // ─── Raydium CLMM аккаунты ────────────────────────────────────────────

    /// Состояние пула
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,

    /// Position NFT mint (новый keypair, создаётся Raydium)
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,

    /// ATA позиции — принадлежит vault_state (владелец позиции)
    /// CHECK: создаётся Raydium CPI
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// Personal position state (создаётся Raydium)
    /// CHECK: создаётся и валидируется Raydium
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,

    /// Tick array нижней границы
    /// CHECK: валидируется Raydium
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,

    /// Tick array верхней границы
    /// CHECK: валидируется Raydium
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// Vault пула для token0
    #[account(mut)]
    pub token_vault_0: InterfaceAccount<'info, TokenAccount>,

    /// Vault пула для token1
    #[account(mut)]
    pub token_vault_1: InterfaceAccount<'info, TokenAccount>,

    /// Mint token0 пула
    pub vault_0_mint: InterfaceAccount<'info, Mint>,

    /// Mint token1 пула
    pub vault_1_mint: InterfaceAccount<'info, Mint>,

    /// Tick array bitmap extension
    /// CHECK: валидируется Raydium
    pub tick_array_bitmap: UncheckedAccount<'info>,

    /// Raydium CLMM program (devnet: DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH)
    /// CHECK: проверяется через address = raydium_clmm_cpi::id()
    #[account(address = raydium_clmm_cpi::id())]
    pub clmm_program: UncheckedAccount<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler<'a, 'b, 'c: 'info, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, OpenRaydiumPosition<'info>>,
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_array_lower_start_index: i32,
    tick_array_upper_start_index: i32,
    liquidity: u128,
    amount_0_max: u64,
    amount_1_max: u64,
) -> Result<()> {
    require!(tick_lower_index < tick_upper_index, crate::VaultError::InvalidTickRange);
    require!(liquidity > 0, crate::VaultError::ZeroAmount);

    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let vault_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

    // Определяем: vault_token_account = token0 или token1?
    // Смотрим mint pool_vault_0: если совпадает с MyToken → token0, иначе → token1.
    let my_token_mint = ctx.accounts.vault_state.token_mint;
    let pool_mint_0 = ctx.accounts.vault_0_mint.key();

    let (token_account_0, token_account_1) = if pool_mint_0 == my_token_mint {
        // MyToken = token0, wSOL = token1
        (
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.vault_wsol_account.to_account_info(),
        )
    } else {
        // wSOL = token0, MyToken = token1
        (
            ctx.accounts.vault_wsol_account.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
        )
    };

    // Raydium transfers tokens using payer (admin) as authority.
    // Our vault accounts are owned by vault_state PDA → approve admin as delegate first.
    let (my_token_max, wsol_max) = if pool_mint_0 == my_token_mint {
        (amount_0_max, amount_1_max) // MyToken=token0, wSOL=token1
    } else {
        (amount_1_max, amount_0_max) // wSOL=token0, MyToken=token1
    };

    token_interface::approve(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: ctx.accounts.vault_token_account.to_account_info(),
                delegate: ctx.accounts.admin.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            &[&[b"vault", token_mint_key.as_ref(), &[bump]]],
        ),
        my_token_max,
    )?;

    token_interface::approve(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: ctx.accounts.vault_wsol_account.to_account_info(),
                delegate: ctx.accounts.admin.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            &[&[b"vault", token_mint_key.as_ref(), &[bump]]],
        ),
        wsol_max,
    )?;

    let remaining = ctx.remaining_accounts.to_vec();

    let cpi_accounts = cpi::accounts::OpenPositionWithToken22Nft {
        payer: ctx.accounts.admin.to_account_info(),
        position_nft_owner: ctx.accounts.vault_state.to_account_info(), // vault PDA владеет NFT
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.personal_position.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        token_account_0,
        token_account_1,
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        vault_0_mint: ctx.accounts.vault_0_mint.to_account_info(),
        vault_1_mint: ctx.accounts.vault_1_mint.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.clmm_program.to_account_info(),
        cpi_accounts,
        vault_seeds,
    )
    .with_remaining_accounts(remaining);

    cpi::open_position_with_token22_nft(
        cpi_ctx,
        tick_lower_index,
        tick_upper_index,
        tick_array_lower_start_index,
        tick_array_upper_start_index,
        liquidity,
        amount_0_max,
        amount_1_max,
        true,        // with_metadata
        Some(false), // base_flag: использовать amount_1 как базу
    )?;

    // Revoke delegation after CPI
    token_interface::revoke(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            &[&[b"vault", token_mint_key.as_ref(), &[bump]]],
        ),
    )?;

    token_interface::revoke(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.vault_wsol_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            &[&[b"vault", token_mint_key.as_ref(), &[bump]]],
        ),
    )?;

    msg!(
        "Position opened: tick_lower={}, tick_upper={}, liquidity={}",
        tick_lower_index,
        tick_upper_index,
        liquidity
    );
    Ok(())
}
