# Multiplayer Poker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship playable public 6-max No-Limit Hold'em v1 (Phaser client + Colyseus server + shared engine) with play-money chips.

**Architecture:** Monorepo npm workspaces. `shared/poker-engine` pure TS rules, `server` Colyseus TableRoom authoritative per table, `client` Phaser 3 renders only. Supabase Auth + Postgres for users/balances outside hand loop.

**Tech Stack:** TypeScript 5.4, Node 20+, Phaser 3.80, Colyseus 0.15, Vite 5, Vitest 2, Supabase JS 2, zod 3.

**Spec:** `docs/superpowers/specs/2026-10-04-multiplayer-poker-design.md`

## Global Constraints
- 6-max No-Limit Texas Hold'em only.
- Blinds 100/200, buy-in 10k play chips, rebuy when <2k, daily refill to 10k.
- Turn timer 15s: auto-check if free else auto-fold. Street delay 2s. Reconnect grace 60s.
- Server authoritative: client sends intents only (`fold|check|call|raiseTo`). Server validates turn, amount in [minRaiseTo,maxRaiseTo], stack sufficient.
- Hole cards private per seat; public state diff only. RNG v1 = `crypto.randomInt` behind `RNG` interface. Chip settlement server-side transactional.
- Heads-up: button posts SB. Odd split chip to earliest left of button.
- No real-money, chat, tournaments, Omaha in v1.

## Review Focus
- Rapid double all-in from laggy client debits chips once, second rejected with INSUFFICIENT — expect single pot contribution.
- Modified client sends `raiseTo: 9999999` with 10k stack — expect BAD_AMOUNT rejection, no state change.
- Sniffing network sees own hole cards but never opponents' — expect filtered state.
- Disconnect mid-hand then reconnect at 59s — expect same seat + hole cards restored.
- 3-way all-in different stacks with tied board — expect 2+ side pots split correctly, total out == total in.

---

### Task 1: Monorepo scaffold + shared cards/deck/RNG

**Files:**
- Create: `package.json` (workspaces: client, server, shared/poker-engine)
- Create: `shared/poker-engine/package.json`, `shared/poker-engine/src/cards.ts`, `shared/poker-engine/src/rng.ts`, `shared/poker-engine/src/deck.ts`
- Test: `shared/poker-engine/tests/deck.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `Card {rank:2-14, suit:0-3}`, `RNG {shuffle<T>(arr:T[]):void}`, `CryptoRNG implements RNG`, `SeededRNG(seed:number) implements RNG`, `Deck(rng:RNG) {shuffle():void; draw():Card; remaining():number}`

- [ ] **Step 1: Write the failing test**
```ts
// shared/poker-engine/tests/deck.test.ts
import { describe, it, expect } from 'vitest';
import { Deck } from '../src/deck.js';
import { SeededRNG } from '../src/rng.js';
describe('Deck', () => {
  it('deals 52 unique cards then empty', () => {
    const d = new Deck(new SeededRNG(1)); d.shuffle();
    const seen = new Set(Array.from({length:52}, () => { const c=d.draw(); return c.rank*10+c.suit; }));
    expect(seen.size).toBe(52); expect(d.remaining()).toBe(0);
  });
  it('seeded shuffle is deterministic', () => {
    const a = new Deck(new SeededRNG(42)); a.shuffle(); const c1=a.draw();
    const b = new Deck(new SeededRNG(42)); b.shuffle(); const c2=b.draw();
    expect(c1).toEqual(c2);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --workspace shared/poker-engine test -- deck.test.ts`
Expected: FAIL with "Cannot find module / not defined"
- [ ] **Step 3: Implement `Card`, `CryptoRNG`, `SeededRNG` (mulberry32 + crypto.randomInt), `Deck` in exact files above**
Use `suit: 0=spades,1=hearts,2=diamonds,3=clubs`. `draw()` throws `DECK_EMPTY` when empty.
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --workspace shared/poker-engine test -- deck.test.ts`
Expected: PASS 2/2
- [ ] **Step 5: Commit**
```bash
git add package.json shared/poker-engine/
git commit -m "feat(engine): deck, RNG, monorepo scaffold"
```

### Task 2: Hand evaluator (7-card best-5)

**Files:**
- Create: `shared/poker-engine/src/evaluator.ts`
- Test: `shared/poker-engine/tests/evaluator.test.ts`

**Interfaces:**
- Consumes: `Card` from Task 1.
- Produces: `HandRank {category:0-8 (0=high..8=straight-flush), kickers:number[]}`, `evaluateBest5(seven:Card[]):HandRank`, `compareRanks(a:HandRank,b:HandRank):number`

- [ ] **Step 1: Write the failing test**
```ts
// key fixtures, not exhaustive here — full file has 12 cases
expect(evaluateBest5(royalFlush).category).toBe(8);
expect(evaluateBest5(wheelStraightA2345).category).toBe(4); // wheel, 5-high
expect(compareRanks(pairKings, pairQueens)).toBeGreaterThan(0);
expect(compareRanks(splitPotSameFlush, splitPotSameFlush2)).toBe(0);
```
Full test file covers all 9 categories + wheel + kicker + tie.
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --workspace shared/poker-engine test -- evaluator.test.ts`
Expected: FAIL
- [ ] **Step 3: Implement `evaluateBest5` in `shared/poker-engine/src/evaluator.ts`**
Count ranks/suits, check flush then wheel-aware straight, standard 7462-style categorization simplified. No IO.
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --workspace shared/poker-engine test -- evaluator.test.ts`
Expected: PASS 12/12
- [ ] **Step 5: Commit**
```bash
git add shared/poker-engine/src/evaluator.ts shared/poker-engine/tests/evaluator.test.ts
git commit -m "feat(engine): 7-card evaluator"
```

### Task 3: Side pots + betting table machine

**Files:**
- Create: `shared/poker-engine/src/pots.ts`, `shared/poker-engine/src/table.ts`
- Test: `shared/poker-engine/tests/pots.test.ts`, `shared/poker-engine/tests/table.test.ts`

**Interfaces:**
- Consumes: `Card, Deck, RNG, evaluateBest5` from Tasks 1-2.
- Produces: `PotManager.buildSidePots(contribs:{seat:number,amount:number}[]):{eligible:number[],amount:number}[]`, `Table(seats:6, button:number, sb=100, bb=200)` with `postBlinds()`, `act(seat, intent)`, `advanceStreet(cards)`, `showdown():{winners, pots}`. Intents: `{t:'fold'}|{t:'call'}|{t:'raiseTo', to:number}`. Errors: `NOT_YOUR_TURN|BAD_AMOUNT|INSUFFICIENT|HAND_OVER`.

- [ ] **Step 1: Write failing side-pot + table tests**
```ts
// 3-way all-in 10k/6k/4k → 3 pots 12k/4k/8k; tie splits; odd chip to left of button
expect(buildSidePots([{seat:0,amount:10000},{seat:1,amount:6000},{seat:2,amount:4000}]).map(p=>p.amount)).toEqual([12000,4000,8000]);
// table: 15s timer not in engine — engine rejects out-of-turn, short raise, over-stack raise
expect(()=>table.act(1,{t:'raiseTo',to:50})).toThrow('BAD_AMOUNT');
```
Full files: 8 pot cases incl. Review Focus 5-way tie, 6 table cases incl. double all-in idempotency guard.
- [ ] **Step 2: Run to verify fail**
Run: `npm --workspace shared/poker-engine test -- pots.test.ts table.test.ts`
Expected: FAIL
- [ ] **Step 3: Implement `PotManager` (sort by contribution, layer pots) and `Table` (button/blinds incl. heads-up SB, callTo/minRaise tracking, side-pot on showdown via evaluator)**
Total-out == total-in invariant enforced; throw codes above.
- [ ] **Step 4: Run to verify pass**
Run: `npm --workspace shared/poker-engine test`
Expected: PASS all engine suites
- [ ] **Step 5: Commit**
```bash
git add shared/poker-engine/src/pots.ts shared/poker-engine/src/table.ts shared/poker-engine/tests/
git commit -m "feat(engine): side pots and betting machine"
```

### Task 4: Colyseus TableRoom (authoritative)

**Files:**
- Create: `server/package.json`, `server/src/rooms/TableRoom.ts`, `server/src/wallet.ts`, `server/src/schema.ts`, `server/src/index.ts`
- Test: `server/tests/tableRoom.sim.test.ts`

**Interfaces:**
- Consumes: `Table, PotManager, RNG, Wallet` (engine from Tasks 1-3).
- Produces: Room `poker-table` messages: client→`{t:'seat'}|{t:'fold'}|{t:'call'}|{t:'raiseTo',to}`; server→`state{seats, community, pots, actingSeat, deadline, button}` + private `hole(cards)`; `Wallet {debit,credit}`, `SupabasePlayWallet` stub in-memory for tests.

- [ ] **Step 1: Write failing sim test**
```ts
// full 6-player scripted hand to showdown + timeout auto-fold + disconnect resync + double all-in single-debit
const room = await bootTestRoom([10000 x6]);
room.send(seat0,{t:'raiseTo',to:9999999}); // Review Focus: over-stack
expect(lastReject.code).toBe('BAD_AMOUNT');
```
Full test: join 6, play blinds→river, assert pots paid, balances conserved, private hole never in public state snapshot of another seat.
- [ ] **Step 2: Run to verify fail**
Run: `npm --workspace server test -- tableRoom.sim.test.ts`
Expected: FAIL (room not defined)
- [ ] **Step 3: Implement `TableRoom`**
zod-validate msgs, 20/sec throttle, `clock.setTimeout(15000)` turn expiry → auto-check/fold, 2s street delay via `clock.setTimeout(2000)` before flop/turn/river/showdown broadcast, `onLeave` 60s reservation + `allowReconnection`, private hole via `client.send('hole')`, public schema excludes hole cards. Filter check: snapshot for seat i contains no other seat's cards.
- [ ] **Step 4: Run to verify pass**
Run: `npm --workspace server test`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/
git commit -m "feat(server): authoritative TableRoom"
```

### Task 5: Phaser client Lobby + TableScene

**Files:**
- Create: `client/package.json`, `client/src/main.ts`, `client/src/net.ts`, `client/src/scenes/LobbyScene.ts`, `client/src/scenes/TableScene.ts`
- Test: manual checklist `client/MANUAL.md` (no unit; visual + net)

**Interfaces:**
- Consumes: server room protocol from Task 4 (`net.ts: joinTable(roomId, buyIn): Room`).
- Produces: `LobbyScene` (balance, table list, Join), `TableScene.render(state)` (6 seats, community, pot, 15s timer ring, bet slider + 1/2-pot/pot/all-in), action bar sends intents only.

- [ ] **Step 1: Write failing manual gate (no code yet, checklist must fail)**
`client/MANUAL.md`: join table <5s, 15s timer visible, raise slider clamps to [min,max], opponent cards hidden, disconnect dot + resync works.
- [ ] **Step 2: Verify gate fails (scenes missing)**
Run: `npm --workspace client run build`
Expected: FAIL (entry missing)
- [ ] **Step 3: Implement scenes with generated card sprites (no external art), 1280x720 landscape**
`net.ts` wraps colyseus.js, disables action buttons when not actingSeat, timer ring from `deadline-Date.now()`.
- [ ] **Step 4: Verify build passes + manual checklist against local server**
Run: `npm --workspace client run build` Expected: PASS. Then `npm --workspace server run dev` + client `npm run dev` → complete one 2-player hand.
- [ ] **Step 5: Commit**
```bash
git add client/
git commit -m "feat(client): lobby and table scenes"
```

### Task 6: Auth + play wallet + deploy wiring

**Files:**
- Create: `server/src/auth.ts`, `server/src/compliance.ts`, `client/src/auth.ts`, `.env.example`
- Modify: `server/src/wallet.ts` (Supabase Postgres impl), `client/src/scenes/LobbyScene.ts` (balance + refill button)
- Test: `server/tests/wallet.test.ts`

**Interfaces:**
- Consumes: `Wallet, Compliance` from Task 4.
- Produces: `SupabasePlayWallet {debit,credit,getBalance,refill}`, `verifyToken(token):userId`, `AllowAllCompliance.canPlay()->{ok:true}` stub with TODO hooks.

- [ ] **Step 1: Write failing wallet test**
```ts
expect(await wallet.getBalance(u)).toBe(10000);
await wallet.debit(u,200,'tx1'); await expect(wallet.debit(u,999999,'tx2')).rejects.toThrow('INSUFFICIENT');
// double txId idempotent
await wallet.debit(u,100,'dup'); await wallet.debit(u,100,'dup'); expect(await wallet.getBalance(u)).toBe(9700);
```
- [ ] **Step 2: Run to verify fail**
Run: `npm --workspace server test -- wallet.test.ts`
Expected: FAIL
- [ ] **Step 3: Implement Supabase impl (service-role on server only, never expose key to client) + refill + `.env.example` (SUPABASE_URL, ANON_KEY client / SERVICE_KEY server, COLYSEUS_PORT)**
- [ ] **Step 4: Run to verify pass + push both processes**
Run: `npm --workspace server test` Expected: PASS. Then `git push origin main`.
- [ ] **Step 5: Commit**
```bash
git add server/src/auth.ts server/src/compliance.ts server/src/wallet.ts client/src/auth.ts .env.example
git commit -m "feat: auth, play wallet, deploy config"
```
