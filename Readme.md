# DecentralWatch Capstone: On-Chain State Layer
This repository contains the on-chain program and mirroring service for **DecentralWatch**, a DePIN (Decentralized Physical Infrastructure Network) for crowdsourcing web uptime monitoring. This project serves as a verifiable and immutable state layer for the network, bringing transparency and auditability to our off-chain operations.

---

## The Architectural Challenge

Our Electron-based client application creates a local, non-custodial wallet for each user upon installation, giving them control over their on-chain identity. The core challenge was: how do we record their network activity (liveness, contributions) on-chain without forcing them to manually approve background transactions and manage gas fees? Constant pop-ups for routine "heartbeat" tasks would create a disruptive and poor user experience.

---

## The Solution: A Hybrid Gasless Architecture

To solve this, we implemented a **hybrid architecture** that separates user identity from transaction execution. The user's local wallet is their on-chain identity (`owner`), but a central, backend hub wallet (`authority`) pays the gas and executes the transactions on their behalf.

The data flow is simple and robust:

**`User's Electron App (Local Wallet)`** → **`Backend Hub (Observes Activity)`** → **`Node.js Cron Job (Pays Gas & Executes)`** → **`Solana On-Chain Program`**

This model provides the best of both worlds:

* **For Users:** A seamless experience with self-custody of their identity, but no need to manage gas or sign for routine network tasks.
* **For the Network:** A publicly verifiable, immutable record of validator activity on Solana, where each record is tied to a user's self-custodied keypair.

---

## System Components

### 1. On-Chain Program (The Source of Truth)

The core of this capstone is a minimal, secure Anchor program deployed on Solana. Its sole purpose is to act as the network's on-chain state layer.

* **`GlobalState` Account:** A singleton account that holds the public key of our backend hub, designating it as the one and only `authority` that can pay for and execute state changes.
* **`Validator` Account:** A PDA created for each participant, seeded by their local wallet's public key. It stores essential, publicly verifiable data:
    * User's public key (`owner`)
    * Geolocation data (`geo_iso2`, `location`)
    * Current operational `status`
    * A `last_active_timestamp` and `last_active_slot`, which are updated by our backend and serve as a verifiable, server-side "heartbeat."
* **`upsert_validator_by_hub` Instruction:** The primary function of the contract. It can only be called by the designated hub `authority` but acts on the `Validator` PDA belonging to a specific user.

### 2. Off-Chain Bridge (The Gasless Relay Service)

A `TypeScript` script (`apps/hub/cron/syncMirror.ts`) acts as the bridge between our off-chain and on-chain worlds.

* **Execution:** It's designed to be run as a cron job (e.g., hourly).
* **Function:** It connects to our production database, queries for users who have been active in the last hour, and calls the `upsert_validator_by_hub` instruction for each one. Crucially, it signs and pays for the transaction with the hub's authority keypair.

---

## Key Benefits of this Architecture

* **Public Verifiability:** Anyone can query our on-chain program to independently audit the status and activity of the DecentralWatch network.
* **Self-Custody with Seamless UX:** Users retain control of their on-chain identity via their local keypair, but are abstracted away from the complexities of gas and transaction signing for routine operations.
* **Scalability & Cost-Effectiveness:** By keeping logic off-chain and only mirroring essential state, we minimize on-chain fees and complexity, ensuring the system can scale efficiently.
* **Pragmatic Design:** This solution demonstrates a mature, product-focused approach to integrating blockchain technology, solving a real business problem without being dogmatic about decentralization at the expense of usability.