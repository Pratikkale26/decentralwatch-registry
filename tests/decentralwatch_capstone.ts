import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DecentralwatchCapstone } from "../target/types/decentralwatch_capstone";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("decentralwatch_capstone", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .DecentralwatchCapstone as Program<DecentralwatchCapstone>;

  // Define constants directly in the test for robustness.
  const SEED_STATE = "state";
  const SEED_VALIDATOR = "validator";
  const STATUS_ACTIVE = 1;
  const STATUS_PENDING = 0;
  const STATUS_BANNED = 3;

  // Keypairs for the test accounts
  const authority = provider.wallet as anchor.Wallet;
  const validatorOwner = Keypair.generate();
  const newAuthority = Keypair.generate();

  // PDA Addresses
  let statePda: PublicKey;
  let validatorPda: PublicKey;

  before(async () => {
    // Derive the PDA addresses we will need for the tests
    [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(SEED_STATE)],
      program.programId
    );
    [validatorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(SEED_VALIDATOR), validatorOwner.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initializes the program state", async () => {
    await program.methods
      .initState()
      .accounts({
        state: statePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stateAccount = await program.account.globalState.fetch(statePda);
    assert.ok(stateAccount.authority.equals(authority.publicKey));
    assert.equal(stateAccount.paused, false);
  });

  it("Upserts a new validator", async () => {
    const geo_iso2 = [...Buffer.from("IN")];
    const locationString = "Surat, GJ";
    const locationBytes = new Uint8Array(32);
    locationBytes.set(Buffer.from(locationString));
    const metadata_hash = Array(32).fill(1);

    await program.methods
      .upsertValidatorByHub(
        geo_iso2,
        [...locationBytes],
        STATUS_PENDING,
        metadata_hash
      )
      .accounts({
        state: statePda,
        authority: authority.publicKey,
        owner: validatorOwner.publicKey,
        validator: validatorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const validatorAccount = await program.account.validator.fetch(validatorPda);
    assert.ok(validatorAccount.owner.equals(validatorOwner.publicKey));
    // Anchor converts snake_case (geo_iso2) to camelCase (geoIso2) in the client
    assert.deepEqual(validatorAccount.geoIso2, geo_iso2);
    assert.equal(validatorAccount.status, STATUS_PENDING);
    assert.isTrue(validatorAccount.lastActiveSlot.gtn(0));

    const storedLocation = Buffer.from(validatorAccount.location)
      .toString()
      .replace(/\0/g, "");
    assert.equal(storedLocation, locationString);
  });

  it("Updates an existing validator", async () => {
    const newLocationString = "Bengaluru, KA";
    const newLocationBytes = new Uint8Array(32);
    newLocationBytes.set(Buffer.from(newLocationString));
    const new_metadata_hash = Array(32).fill(2);

    await program.methods
      .upsertValidatorByHub(
        [...Buffer.from("IN")],
        [...newLocationBytes],
        STATUS_ACTIVE,
        new_metadata_hash
      )
      .accounts({
        state: statePda,
        authority: authority.publicKey,
        owner: validatorOwner.publicKey,
        validator: validatorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const validatorAccount = await program.account.validator.fetch(validatorPda);
    assert.equal(validatorAccount.status, STATUS_ACTIVE);
    const storedLocation = Buffer.from(validatorAccount.location)
      .toString()
      .replace(/\0/g, "");
    assert.equal(storedLocation, newLocationString);
  });

  it("Fails to upsert with invalid status input", async () => {
    try {
      await program.methods
        .upsertValidatorByHub(
          [...Buffer.from("US")],
          Array(32).fill(0),
          STATUS_BANNED + 1, // Invalid status
          Array(32).fill(0)
        )
        .accounts({
          state: statePda,
          authority: authority.publicKey,
          owner: validatorOwner.publicKey,
          validator: validatorPda,
        })
        .rpc();
      assert.fail("Should have failed with InvalidInput");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "InvalidInput");
    }
  });

  it("Transfers authority", async () => {
    await program.methods
      .setParams(newAuthority.publicKey, null)
      .accounts({
        state: statePda,
        authority: authority.publicKey,
      })
      .rpc();

    const stateAccount = await program.account.globalState.fetch(statePda);
    assert.ok(stateAccount.authority.equals(newAuthority.publicKey));
  });

  it("Prevents old authority from setting params", async () => {
    try {
      await program.methods
        .setParams(null, true)
        .accounts({
          state: statePda,
          authority: authority.publicKey, // Old authority
        })
        .rpc();
      assert.fail("Should have failed with Unauthorized");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "Unauthorized");
    }
  });

  it("Allows new authority to pause the program", async () => {
    await program.methods
      .setParams(null, true)
      .accounts({
        state: statePda,
        authority: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();

    const stateAccount = await program.account.globalState.fetch(statePda);
    assert.isTrue(stateAccount.paused);
  });

  it("Prevents upserts when paused", async () => {
    try {
      await program.methods
        .upsertValidatorByHub(
          [...Buffer.from("CA")],
          Array(32).fill(0),
          STATUS_ACTIVE,
          Array(32).fill(0)
        )
        .accounts({
          state: statePda,
          authority: newAuthority.publicKey,
          owner: validatorOwner.publicKey,
          validator: validatorPda,
        })
        .signers([newAuthority])
        .rpc();
      assert.fail("Should have failed because program is paused");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "Paused");
    }
  });
});
