# Multiplayer Poker — Design Spec (2026-10-04)

## 1. Intent & Success
- **Outcome:** Public browser Texas Hold'em game, strangers can join tables and complete full hands fairly.
- **Who:** Public players on desktop browser v1.
- **Stack decision:** Phaser 3 client (render/input only) + authoritative Node server via Colyseus (approach A).
- **Economy v1:** Play-money chips only. 10k buy-in, 100/200 blinds, daily refill. Wallet + RNG behind interfaces for future licensed real-money plug-in. No real-money, KYC, payments in v1.
- **Success criteria:**
  1. Join table from lobby in <5s, 6-max fills with real players.
  2. Full No-Limit hand (blinds → preflop → flop → turn → river → showdown + side pots) completes without server trust in client.
  3. Client tampering (altered bet, peeking cards) has no effect.
  4. Disconnect + reconnect within 60s resumes seat; timeout auto-check/folds.
  5. Chip balances persist across sessions, total chips conserved.

## 2. Architecture
Monorepo:
```
/client — Phaser 3 + TypeScript + Vite. Scenes only, no rules.
/server — Colyseus 0.15+ TableRoom per table, authoritative poker-engine.
/shared/poker-engine — pure TS: deck, blinds, betting rounds, side pots, 7-card evaluator. No IO.
/supabase — Auth + Postgres: users, chip balances, table directory (outside hand loop).
```

- Each table = one Colyseus `TableRoom` (6 seats). Lobby lists rooms via Colyseus matchmaker.
- Server holds full deck + all hole cards. Broadcast = public state to all + private `holeCards` only to owning seat (per-client filtered patch).
- Client sends intents only: `seat`, `fold`, `check/call`, `raiseTo(amount)`. Never sends cards, pot, or outcome.
- Interfaces for real-money future:
  ```ts
  interface RNG { shuffle(deck: Card[]): void; draw(): Card }
  interface Wallet { debit(userId, amount, txId): Promise<void>; credit(...): Promise<void> }
  interface Compliance { canPlay(userId, ip, geo): Promise<{ok:boolean; reason?:string}> }
  ```
  v1 impl: `CryptoRNG` (crypto.randomInt), `SupabasePlayWallet`, `AllowAllCompliance` stub.

## 3. MVP Scope
**In:**
- 6-max No-Limit Texas Hold'em, 100/200 blinds, 10k buy-in (rebuy when <2k, daily refill to 10k).
- Turn timer 15s, auto-check if free else auto-fold. Street delay 2s for readability.
- Run-to-showdown, side pots, heads-up blind rules (button = SB heads-up).
- Scenes: Boot → Lobby (balance, table list with seats/avg pot, Join) → TableScene (6 seats, community cards, pot(s), timer ring, bet slider + 1/2-pot/pot/all-in shortcuts, showdown highlight, hand history toast).
- Reconnect: 60s grace, sit-out, auto-play tight.
- Desktop landscape 1280x720 first.

**Out of v1:** Tournaments, Omaha, private friend tables/invite links, chat, avatars/cosmetics, mobile portrait, hand replayer, leaderboards, rakeback, real-money/KYC/payments/geo/RNG certification.

## 4. Data Flow (per hand)
1. `joinOrCreate(TableRoom, {buyIn})` → server `Wallet.debit` → seat assigned, stack set.
2. Button rotates, blinds posted server-side. `CryptoRNG.shuffle`, deal 2 each (private).
3. Betting loop: server sets `actingSeat + legalActions {canCheck, callTo, minRaiseTo, maxRaiseTo} + deadline`. Client renders timer. Intent → validate (your turn? seated? amount in [min,max] and ≤ stack? chip sufficient?) → apply → broadcast.
4. Streets: burn + flop(3)/turn(1)/river(1). All-ins create side pots in engine.
5. Showdown: engine evaluates best 5 of 7 per remaining player, awards pots (split on tie, odd chip to earliest left of button). `Wallet.credit` winners in single transaction. Broadcast `handResult {winners, amounts, shownCards}`.
6. Next hand after 5s if ≥2 seated with chips. Broke players spectate or rebuy.

State sync: Colyseus Schema diff @ 10Hz + immediate on action. Private cards via per-client `send('hole', ...)` not in shared state.

## 5. Components
- **shared/poker-engine:** `Card {rank:2-14, suit:0-3}`, `Deck`, `HandEvaluator.best5(seven): {rankCategory 0-8, kickers}`, `BettingRound`, `PotManager.buildSidePots(contributions)`, `TableStateMachine`. Pure, seeded RNG injectable for tests.
- **server/TableRoom:** `onCreate`, `onJoin` (auth token → Supabase verify → Compliance.canPlay → Wallet.debit), `onMessage(bet)`, `onLeave` (sit-out timer), `onDispose` (refund unbalanced debits). Turn timeout via `clock.setTimeout`. Anti-spam: 20 msgs/sec per client, action size clamped.
- **client/TableScene:** Seats (name, stack, bet discs, timer, dealer button), community + pot text, action bar, connection dot. Optimistic button disable, no prediction. Assets: generated card sprites 64x90 + felt bg, no external art v1.
- **Lobby:** Supabase Auth (email/OAuth), balance display, table list polling, Create/Join, refill button.

## 6. Error Handling
- Illegal action → `reject(code: NOT_YOUR_TURN | BAD_AMOUNT | INSUFFICIENT | HAND_OVER)` toast, no state change, logged.
- Full table → `TABLE_FULL` + queue position, auto-seat on leave.
- Disconnect → seat reserved 60s, hand auto-checked/folded; reconnect restores hole cards via private resend.
- Server crash → on restart balances authoritative from Postgres; in-progress hand voided, debits rolled back (no resume v1).
- Client desync → full-state `resync` on sequence gap >5.
- Rate/abuse: IP throttle join attempts, bet payload schema-validated with zod.

## 7. Testing
- Engine unit (vitest): all 9 categories (high → royal), 200+ evaluator fixtures, 20+ side-pot splits (multi all-in, ties, odd chips), blind heads-up vs full ring, chip conservation property test.
- Server sim: scripted 6-player full hand, timeout fold, disconnect/reconnect, double-spend attempt (two rapid all-ins) → only one applied.
- Client: manual lobby → table → showdown checklist + Colyseus latency simulation.
- Gate: all tests green before preview/publish.

## 8. Real-Money Readiness (non-goals fenced)
No gambling license, KYC/AML, payments, geofencing, certified RNG, responsible-gaming limits in v1. Code isolates them behind interfaces above + `docs/real-money-todo.md` to be written at implementation (jurisdiction matrix, provider choice, audit log). Play-money balances explicitly non-withdrawable in ToS copy.

## 9. Build Order (for plan)
1. shared/poker-engine + evaluator tests.
2. server TableRoom + RNG/Wallet stubs + sim tests.
3. client Lobby + TableScene wired to local Colyseus.
4. Supabase auth + balances + deploy (client Vercel/Netlify, server Fly/Render).
5. Polish timers, showdown, refill, reconnect.

Approved sections 1-4 on 2026-10-04. Approach A confirmed.
