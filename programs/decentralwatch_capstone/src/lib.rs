use anchor_lang::prelude::*;

declare_id!("J5B8jUqhDgJg1eAEnRT2KFEMExSWS8wSy9YufqLwwUxi");

// Seeds
pub const SEED_STATE: &[u8]     = b"state";
pub const SEED_VALIDATOR: &[u8] = b"validator";

// Status (u8)
pub const STATUS_PENDING: u8 = 0;
pub const STATUS_ACTIVE:  u8 = 1;
pub const STATUS_PAUSED:  u8 = 2;
pub const STATUS_BANNED:  u8 = 3;

#[program]
pub mod decentralwatch_capstone {
    use super::*;

    /// One-time init by the hub authority
    pub fn init_state(ctx: Context<InitState>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.paused = false;
        state.bump = ctx.bumps.state;

        emit!(StateInitialized { authority: state.authority });
        Ok(())
    }

    /// Update authority / pause flag
    pub fn set_params(
        ctx: Context<SetParams>,
        new_authority: Option<Pubkey>,
        paused: Option<bool>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        if let Some(a) = new_authority { state.authority = a; }
        if let Some(p) = paused         { state.paused    = p; }

        emit!(ParamsChanged { authority: state.authority, paused: state.paused });
        Ok(())
    }

    /// Mirror from hub/cron: create or update a validator record.
    /// `last_active_*` acts as "liveness" signal.
    pub fn upsert_validator_by_hub(
        ctx: Context<UpsertValidatorByHub>,
        geo_iso2: [u8; 2],
        location: [u8; 32],
        status: u8,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.state.paused, Errs::Paused);
        require!(status <= STATUS_BANNED, Errs::InvalidInput);

        let clock = Clock::get()?;
        let v = &mut ctx.accounts.validator;

        // First-time init
        if v.owner == Pubkey::default() {
            v.owner = ctx.accounts.owner.key();
            v.bump  = ctx.bumps.validator;
        }

        // Mirror fields from hub
        v.geo_iso2              = geo_iso2;
        v.location              = location;
        v.status                = status;
        v.metadata_hash         = metadata_hash;
        v.last_active_timestamp = clock.unix_timestamp;
        v.last_active_slot      = clock.slot;

        emit!(ValidatorUpserted {
            owner: v.owner,
            status: v.status,
            geo_iso2: v.geo_iso2,
            location: v.location,
            last_active_timestamp: v.last_active_timestamp,
            last_active_slot: v.last_active_slot,
            metadata_hash: v.metadata_hash,
        });

        Ok(())
    }
}

//State 
#[account]
#[derive(Default)]
pub struct GlobalState {
    pub authority: Pubkey,
    pub paused: bool,
    pub bump: u8,
}
impl GlobalState {
    pub const SIZE: usize = 32 + 1 + 1;
}

#[account]
#[derive(Default)]
pub struct Validator {
    pub owner: Pubkey,              // 32
    pub geo_iso2: [u8; 2],          // 2
    pub location: [u8; 32],         // 32
    pub status: u8,                 // 1 (0..3)
    pub last_active_timestamp: i64, // 8
    pub last_active_slot: u64,      // 8
    pub metadata_hash: [u8; 32],    // 32
    pub bump: u8,                   // 1
}
impl Validator {
    // size = 32+2+32+1+8+8+32+1 = 116
    pub const SIZE: usize = 116;
}

// Accounts 

#[derive(Accounts)]
pub struct InitState<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::SIZE,
        seeds = [SEED_STATE],
        bump
    )]
    pub state: Account<'info, GlobalState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetParams<'info> {
    #[account(
        mut,
        has_one = authority @ Errs::Unauthorized
    )]
    pub state: Account<'info, GlobalState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpsertValidatorByHub<'info> {
    #[account(
        seeds = [SEED_STATE], 
        bump = state.bump
    )]
    pub state: Account<'info, GlobalState>,

    /// Hub authority must sign; constraint enforces it's the current authority.
    #[account(
        mut, 
        address = state.authority @ Errs::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Validator's wallet; only used as PDA seed.
    pub owner: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Validator::SIZE,
        seeds = [SEED_VALIDATOR, owner.key().as_ref()],
        bump
    )]
    pub validator: Account<'info, Validator>,

    pub system_program: Program<'info, System>,
}

//  Events 
#[event] pub struct StateInitialized { pub authority: Pubkey }
#[event] pub struct ParamsChanged   { pub authority: Pubkey, pub paused: bool }

#[event]
pub struct ValidatorUpserted {
    pub owner: Pubkey,
    pub status: u8,
    pub geo_iso2: [u8; 2],
    pub location: [u8; 32],
    pub last_active_timestamp: i64,
    pub last_active_slot: u64,
    pub metadata_hash: [u8; 32],
}

// Errors 
#[error_code]
pub enum Errs {
    #[msg("Unauthorized: signer is not the authority")] Unauthorized,
    #[msg("Program is paused")] Paused,
    #[msg("Invalid input")] InvalidInput,
}
