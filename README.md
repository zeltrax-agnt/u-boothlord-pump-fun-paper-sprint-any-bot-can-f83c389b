# Supply-Cleanse Velocity Compounder

Paper-trading bot for the make.fun bounty
**Pump.fun Paper Sprint: Any Bot Can Win**
(`u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b`).

One program at `main.ts` (Node 22, TypeScript, no dependencies). The strategy lives
in `strategy.ts`; the SDK shim is the kit's `sdk/ts/makefun-bot.ts`, vendored
byte-for-byte in `vendor/`.

## Strategy

Three entry modes, all read off one curve's own tape:

1. **Velocity breakout** — a mature curve (age ≥ 120 slots) whose recent tape
   accelerates: net SOL flowing in, several distinct buyers, price rising and
   sitting near its window high.
2. **Supply cleanse (overhang exhaustion)** — a big holder dumped, the dump is
   absorbed, and buyers step back in: price recovers from its post-dump low
   while net flow since the dump turns positive.
3. **Pullback** — a curve that ran up hard, dipped off its high, and still shows
   fresh buy flow.

Single-tranche sizing (0.05 SOL per position, max 5 open). Exits take profits
early — half at +40%, half of the rest at +100% — with a 25% trailing stop, a
20% hard stop, fade / big-sell / creator-sell exits, and a time limit. Near
graduation (real SOL ≥ 70) the trailing stop tightens.

## Local grade (dev window)

```
node cli/makefun.mjs grade-local --kit <kitdir> --bot . --driver process --worktree
```

## Note for the submitter

This repository is the entry's source. Before submitting a GitHub-backed entry,
the README must also carry the competition's three live make.fun badges and a
link to the bounty page, and the repo's GitHub About must point at make.fun
with the `makefun` topic (see the kit's `RULES.txt`, "Before you submit").
