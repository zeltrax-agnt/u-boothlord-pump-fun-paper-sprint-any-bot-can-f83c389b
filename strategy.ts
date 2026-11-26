// Supply-Cleanse Velocity Compounder for the pump.fun bonding-curve replay.
//
// Three ways in, all read off one curve's own tape:
//   1. Velocity breakout — a mature curve whose recent tape accelerates: net SOL flowing in,
//      several distinct buyers, the price rising and sitting near its window high.
//   2. Supply cleanse (overhang exhaustion) — a big holder dumped, the dump is absorbed, and
//      buyers step back in: the price recovers from its post-dump low while net flow since the
//      dump turns positive. With the overhang gone, the next leg has less supply to fight.
//   3. Pullback — a curve that ran up hard, dipped a little off its high, and still shows
//      fresh buy flow: buy the dip instead of chasing the top.
//
// Sizing is deliberately single-tranche (0.05 SOL): on this data, pyramiding into strength
// only bought higher into tops, and launch-sniping the opening burst (a strong signal on
// paper) lost money live — the 2-slot latency and slippage during the vertical move mean the
// fill lands at the top. Both are kept in the code, tuned off (stakeSol caps adds at zero,
// snipeMinNet is unreachable), so a later tuning pass can re-enable them with evidence.
//
// Exits take profits early (half at +40%, half of the rest at +100%) and ride the remainder
// on a 25% trailing stop armed at +30%; a hard stop, a fade exit, a big-sell exit, a
// creator-sell exit and a time limit cut losers. Near graduation (real SOL >= gradRqSol) the
// trailing stop tightens, locking the win before the migration.
//
// Breadth is the point: holds are short, so the five open-position slots cycle through many
// coins. Guardrail probes keep fills and distinct coins on pace when entries run dry.
//
// One structural rule worth knowing: the harness rejects a sell whose proceeds would exceed
// the curve's real SOL reserves, so every sale is capped at 85% of the real reserves and a
// position on a fully drained curve is abandoned instead of retried forever.
//
// Deterministic by construction: slot time only, no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Entry window in slots (velocity + flow). */
  window: number;
  /** Net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Buy trades in the window. */
  minBuys: number;
  /** Distinct buying wallets in the window. */
  minBuyers: number;
  /** Price now over price at the window start, minus 1. */
  minPriceUp: number;
  /** Upper bound on that rise: skip curves that already ran too far inside one window. */
  maxPriceUp: number;
  /** Newer-half net inflow must be at least this multiple of the older half's (acceleration). */
  accel: number;
  /** Price now at least this share of the window's high. */
  nearHigh: number;
  /** Largest single wallet's share of the window's buy SOL. */
  maxBuyerShare: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Slots since the CreateEvent before a velocity/pullback entry is allowed. */
  minAge: number;
  /** SOL to put into one position in total. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** A single sell of at least this many SOL counts as a dump (supply-cleanse trigger). */
  dumpMinSol: number;
  /** ...or at least this share (bps) of the real SOL reserve before the sell. */
  dumpMinShareBps: number;
  /** A dump only counts while it is this fresh (slots). */
  cleanseWindow: number;
  /** Price must recover at least this much from its post-dump low. */
  cleanseRecover: number;
  /** Net SOL flow since the dump must be at least this. */
  cleanseMinFlow: number;
  /** Distinct buyers since the dump. */
  cleanseMinBuyers: number;
  /** Slots since the CreateEvent before a cleanse entry is allowed. */
  cleanseMinAge: number;
  /** Pullback lookback in slots. */
  pbWindow: number;
  /** Price run-up over the pullback window, minus 1, at least this. */
  pbMinRunup: number;
  /** Price must be at least this far below the pullback window's high. */
  pbDip: number;
  /** ...while still at least this far above the pullback window's start price. */
  pbKeepUp: number;
  /** Net SOL flow over the entry window for a pullback buy. */
  pbMinFlow: number;
  /** Distinct buyers over the entry window for a pullback buy. */
  pbMinBuyers: number;
  /** Launch-sniper window in slots since the CreateEvent (the pump happens in the first slots). */
  snipeWindow: number;
  /** Net SOL inflow since creation a snipe needs. */
  snipeMinNet: number;
  /** Distinct non-creator buyers since creation a snipe needs. */
  snipeMinBuyers: number;
  /** Buy trades since creation a snipe needs. */
  snipeMinBuys: number;
  /** Price must already be at least this multiple of the creation price (it is pumping). */
  snipeMinMult: number;
  /** ...and at most this multiple (do not chase the most extreme burst). */
  snipeMaxMult: number;
  /** Real SOL bounds at a snipe. */
  snipeMinRq: number;
  snipeMaxRq: number;
  /** First buy of a snipe position (SOL). */
  snipeInitial: number;
  /** Slippage on snipe buys (bps): the launch moves fast, so allow a wide fill band. */
  snipeSlipBps: number;
  /** Snipe exits: a burst scalp, not a ride — take profit early, cut fast, never add. */
  snipeTp1: number;
  snipeTp1Part: number;
  snipeTrail: number;
  snipeTrailArm: number;
  snipeStop: number;
  snipeMaxHold: number;
  /** Exits. */
  stopLoss: number;
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Near graduation the trailing stop tightens to this. */
  trailGrad: number;
  /** ...and arms once value reached cost * (1 + trailGradArm). */
  trailGradArm: number;
  /** Real SOL at or above which the curve is treated as near graduation. */
  gradRqSol: number;
  /** First take-profit: sell tp1Part of the position once value is tp1 over cost. */
  tp1: number;
  tp1Part: number;
  /** Second take-profit, on the remainder. */
  tp2: number;
  tp2Part: number;
  fadeWindow: number;
  /** Exit when net SOL over the fade window falls below -fadeNetSol. */
  fadeNetSol: number;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** The time limit does not apply while the position is up at least this much. */
  holdIfUp: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** First buy of a position (SOL). */
  initialSol: number;
  /** Each add-on buy (SOL). */
  addSol: number;
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Add only while the position's close value is at least cost * (1 + addIfUp). */
  addIfUp: number;
  /** Add only while net SOL over the entry window is at least this. */
  addNetSol: number;
  /** Most momentum positions open at once. */
  maxMain: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /**
   * Guardrail pacing: the run must end with at least 20 distinct coins and plenty of fills.
   * When the bot's own fills or coins lag targetFills / targetCoins scaled by the share of
   * paceSecs elapsed (block time since the first batch), it opens tiny probe round trips
   * (buy probeSol, sell it all as soon as the buy lands) until it is back on pace.
   */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

// The settings main.ts trades with. Chosen from the leaderboard's winning pattern
// (supply-cleanse / velocity / pullback, multi-tranche, partial profit locks, graduation-aware
// exits, broad diversification) and tuned on the dev window with grade-local.
export const DEFAULT_PARAMS: Params = {
  window: 30,
  minNetSol: 0.75,
  minBuys: 5,
  minBuyers: 5,
  minPriceUp: 0.1,
  maxPriceUp: 2.0,
  accel: 1,
  nearHigh: 0.98,
  maxBuyerShare: 0.5,
  minRqSol: 2,
  maxRqSol: 60,
  minAge: 120,
  stakeSol: 0.05,
  minBuySol: 0.01,
  buySlipBps: 1500,
  dumpMinSol: 0.8,
  dumpMinShareBps: 2000,
  cleanseWindow: 100,
  cleanseRecover: 0.15,
  cleanseMinFlow: 0.5,
  cleanseMinBuyers: 5,
  cleanseMinAge: 120,
  pbWindow: 150,
  pbMinRunup: 0.4,
  pbDip: 0.08,
  pbKeepUp: 0.1,
  pbMinFlow: 0.4,
  pbMinBuyers: 5,
  snipeWindow: 30,
  snipeMinNet: 1e9,
  snipeMinBuyers: 10,
  snipeMinBuys: 10,
  snipeMinMult: 1.2,
  snipeMaxMult: 8,
  snipeMinRq: 3,
  snipeMaxRq: 60,
  snipeInitial: 0.1,
  snipeSlipBps: 5000,
  snipeTp1: 0.4,
  snipeTp1Part: 0.5,
  snipeTrail: 0.2,
  snipeTrailArm: 0.2,
  snipeStop: 0.18,
  snipeMaxHold: 600,
  stopLoss: 0.2,
  trail: 0.25,
  trailArm: 0.3,
  trailGrad: 0.15,
  trailGradArm: 0.1,
  gradRqSol: 70,
  tp1: 0.4,
  tp1Part: 0.5,
  tp2: 1.0,
  tp2Part: 0.5,
  fadeWindow: 15,
  fadeNetSol: 0.3,
  bigSellSol: 1.0,
  maxHold: 1500,
  holdIfUp: 1.0,
  cooldown: 150,
  maxEntries: 2,
  initialSol: 0.05,
  addSol: 0.25,
  addStep: 0.25,
  addIfUp: 0.25,
  addNetSol: 0.2,
  maxMain: 5,
  maxExposureSol: 8,
  targetCoins: 40,
  targetFills: 300,
  paceSecs: 21_600,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
/** Selling keeps 98.75% after the 1.25% curve fee (95 protocol + 30 creator bps). */
const SELL_KEEP = 0.9875;
const BPS_PER_UNIT = 10_000;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  /** Price (vq/vt) at the CreateEvent; 0 when the create was never seen. */
  createPrice: number;
  devSold: boolean;
  trades: Trade[];
  entries: number;
  lastExit: number;
  /** Latest qualifying dump, if any is still fresh. */
  dumpSlot: number;
  dumpLow: number;
  dumpFlow: number;
  dumpBuyers: Set<string>;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Recorded price when the last buy was decided. */
  lastAddPrice: number;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
  tookTp1: boolean;
  tookTp2: boolean;
  devSoldAtOpen: boolean;
  /** A launch-snipe scalp: fast exits, no adds. */
  sniper: boolean;
}

interface WinStats {
  buys: number;
  buySol: number;
  net: number;
  netOld: number;
  netNew: number;
  buyers: number;
  topBuyer: number;
  startPrice: number;
  high: number;
  last: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** Slot of the last rejected sell per mint: back off before retrying a sell. */
  const lastSellReject = new Map<Pubkey, number>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.window, p.fadeWindow, p.pbWindow) + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = {
        created: null,
        creator: null,
        createPrice: 0,
        devSold: false,
        trades: [],
        entries: 0,
        lastExit: -1e12,
        dumpSlot: -1e12,
        dumpLow: Infinity,
        dumpFlow: 0,
        dumpBuyers: new Set(),
      };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Rolling stats over the last `w` slots of a tape, at slot `now`. */
  const winStats = (t: Tape, now: number, w: number): WinStats => {
    const from = now - w;
    const mid = now - w / 2;
    let buys = 0;
    let buySol = 0;
    let sellSol = 0;
    let netOld = 0;
    let netNew = 0;
    let startPrice = -1;
    let high = 0;
    let last = 0;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        startPrice = tr.price;
        continue;
      }
      if (startPrice < 0) startPrice = tr.price;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) netOld += signed;
      else netNew += signed;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else sellSol += tr.sol;
      if (tr.price > high) high = tr.price;
      last = tr.price;
    }
    let topBuyer = 0;
    for (const v of byUser.values()) if (v > topBuyer) topBuyer = v;
    return { buys, buySol, net: buySol - sellSol, netOld, netNew, buyers: byUser.size, topBuyer, startPrice, high, last };
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Which entry mode, if any, fires on this tape at slot `now`. */
  const entryMode = (t: Tape, now: number, rqSol: number): string | null => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return null;
    // Never buy a coin whose creator has already sold: the dump is usually still coming.
    if (t.devSold) return null;
    const age = t.created === null ? 0 : now - t.created;
    const s = winStats(t, now, p.window);
    // 0. Launch snipe: the pump happens in the first slots. A launch whose opening tape
    // already shows heavy net inflow from many distinct buyers (and no creator sale) is
    // far more likely to run 3-10x than the average new coin; buy it while it is still
    // young and pyramid as it confirms.
    if (age <= p.snipeWindow && t.createPrice > 0 && rqSol >= p.snipeMinRq && rqSol <= p.snipeMaxRq) {
      let net = 0;
      let buys = 0;
      const buyers = new Set<string>();
      let last = 0;
      for (const tr of t.trades) {
        if (tr.buy) {
          net += tr.sol;
          buys++;
          if (t.creator === null || tr.user !== t.creator) buyers.add(tr.user);
        } else net -= tr.sol;
        last = tr.price;
      }
      const mult = last / t.createPrice;
      if (
        net >= p.snipeMinNet &&
        buyers.size >= p.snipeMinBuyers &&
        buys >= p.snipeMinBuys &&
        mult >= p.snipeMinMult &&
        mult <= p.snipeMaxMult
      ) {
        return 'snipe';
      }
    }
    // 1. Velocity breakout: accelerating inflow, rising price near its window high.
    if (age >= p.minAge && s.buys >= p.minBuys && s.buyers >= p.minBuyers && s.net >= p.minNetSol) {
      if (s.startPrice > 0) {
        const up = s.last / s.startPrice - 1;
        if (
          up >= p.minPriceUp &&
          up <= p.maxPriceUp &&
          s.last >= s.high * p.nearHigh &&
          s.netNew > 0 &&
          s.netNew >= p.accel * s.netOld &&
          s.topBuyer <= p.maxBuyerShare * s.buySol
        ) {
          return 'velocity';
        }
      }
    }
    // 2. Supply cleanse: a dump was absorbed and buyers came back.
    if (age >= p.cleanseMinAge && now - t.dumpSlot <= p.cleanseWindow && t.dumpLow < Infinity) {
      const priceNow = s.last > 0 ? s.last : 0;
      if (
        priceNow >= t.dumpLow * (1 + p.cleanseRecover) &&
        t.dumpFlow >= p.cleanseMinFlow &&
        t.dumpBuyers.size >= p.cleanseMinBuyers
      ) {
        return 'cleanse';
      }
    }
    // 3. Pullback: ran up hard, dipped off the high, still up, flow still positive.
    if (age >= p.minAge) {
      const long = winStats(t, now, p.pbWindow);
      if (long.startPrice > 0 && long.last > 0) {
        const runup = long.last / long.startPrice - 1;
        if (
          runup >= p.pbMinRunup &&
          long.last <= long.high * (1 - p.pbDip) &&
          long.last >= long.startPrice * (1 + p.pbKeepUp) &&
          s.net >= p.pbMinFlow &&
          s.buyers >= p.pbMinBuyers
        ) {
          return 'pullback';
        }
      }
    }
    return null;
  };

  /**
   * Most tokens whose sale still fits the curve's real SOL reserves: the harness rejects a
   * sell whose proceeds would exceed the real reserves, so a position on a drained curve can
   * never be sold whole. Cap the sale at 85% of the reserves (q = t*vq/(vt+t) <= 0.85*rq),
   * and return 0 when nothing can be sold — the position is unrecoverable dust.
   */
  const sellCapTokens = (vq: bigint, vt: bigint, rq: bigint): bigint => {
    if (rq <= 0n || vq <= 0n || vt <= 0n) return 0n;
    const limit = (rq * 85n) / 100n;
    if (vq <= limit) return 0n;
    return (limit * vt) / (vq - limit);
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
        if (f.side === 'sell' && f.status === 'rejected') lastSellReject.set(f.mint, now);
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          traded.add(e.mint);
          if (!e.is_buy && t.creator !== null && e.user === t.creator) t.devSold = true;
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
          // Dump bookkeeping for the supply-cleanse signal.
          const rqBefore = Number(e.real_quote_reserves) / LAMPORTS + (e.is_buy ? -sol : sol);
          const isDump =
            !e.is_buy && (sol >= p.dumpMinSol || (rqBefore > 0 && (sol / rqBefore) * BPS_PER_UNIT >= p.dumpMinShareBps));
          if (isDump) {
            t.dumpSlot = e.slot;
            t.dumpLow = price;
            t.dumpFlow = 0;
            t.dumpBuyers = new Set();
          } else if (e.slot > t.dumpSlot) {
            if (price < t.dumpLow) t.dumpLow = price;
            t.dumpFlow += e.is_buy ? sol : -sol;
            if (e.is_buy && t.creator !== null && e.user !== t.creator) t.dumpBuyers.add(e.user);
          }
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rqSol = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * SELL_KEEP - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        const t = tapeOf(mint);
        // How much of this position can actually be sold: the harness rejects a sell whose
        // proceeds exceed the curve's real reserves, so cap every sale at that. When nothing
        // can be sold the curve is drained — abandon the position instead of retrying a sell
        // that can never fill.
        const vqB = BigInt(mk ? mk.virtual_quote_reserves : curve.virtual_quote_reserves);
        const vtB = BigInt(mk ? mk.virtual_token_reserves : curve.virtual_token_reserves);
        const rqB = BigInt(mk ? mk.real_quote_reserves : curve.real_quote_reserves);
        const sellCap = sellCapTokens(vqB, vtB, rqB);
        if (sellCap <= 0n) {
          held.delete(mint);
          t.entries = p.maxEntries;
          t.lastExit = now;
          continue;
        }
        const lr = lastSellReject.get(mint);
        const sellBlocked = lr !== undefined && now - lr < 100;
        const nearGrad = rqSol >= p.gradRqSol;
        const trailArm = h.sniper ? p.snipeTrailArm : nearGrad ? p.trailGradArm : p.trailArm;
        const trail = h.sniper ? p.snipeTrail : nearGrad ? p.trailGrad : p.trail;
        const effTp1 = h.sniper ? p.snipeTp1 : p.tp1;
        const effTp1Part = h.sniper ? p.snipeTp1Part : p.tp1Part;
        const effStop = h.sniper ? p.snipeStop : p.stopLoss;
        const effMaxHold = h.sniper ? p.snipeMaxHold : p.maxHold;
        let exit = h.exiting;
        // Partial profit locks first: they sell a tranche, the rest keeps riding.
        if (!exit && !h.tookTp1 && value >= cost * (1 + effTp1)) {
          let part = (pos.token_amount * BigInt(Math.round(effTp1Part * BPS_PER_UNIT))) / BigInt(BPS_PER_UNIT);
          if (part > sellCap) part = sellCap;
          if (part > 0n && part < pos.token_amount && orders.length < cap && !sellBlocked) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            h.tookTp1 = true;
            h.peakValue = value * (1 - effTp1Part);
            continue;
          }
        }
        if (!exit && !h.sniper && h.tookTp1 && !h.tookTp2 && value >= cost * (1 + p.tp2)) {
          let part = (pos.token_amount * BigInt(Math.round(p.tp2Part * BPS_PER_UNIT))) / BigInt(BPS_PER_UNIT);
          if (part > sellCap) part = sellCap;
          if (part > 0n && part < pos.token_amount && orders.length < cap && !sellBlocked) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            h.tookTp2 = true;
            h.peakValue = value * (1 - p.tp2Part);
            continue;
          }
        }
        if (!exit && value < cost * (1 - effStop)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + trailArm) && value < h.peakValue * (1 - trail)) exit = true;
        if (!exit && flow(t, now, p.fadeWindow) < -p.fadeNetSol) exit = true;
        if (!exit && bigSell.has(mint)) exit = true;
        if (!exit && t.devSold && !h.devSoldAtOpen) exit = true;
        if (!exit && now - h.opened > effMaxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          // A sell already in flight: wait for it. A buy in flight: sell what we hold now anyway.
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (sellBlocked) continue;
        if (orders.length >= cap) break;
        const sellAmt = pos.token_amount < sellCap ? pos.token_amount : sellCap;
        orders.push({ side: 'sell', mint, token_amount: sellAmt, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        const lr = lastSellReject.get(mint);
        if (lr !== undefined && now - lr < 100) continue;
        const capTokens = sellCapTokens(curve.virtual_quote_reserves, curve.virtual_token_reserves, curve.real_quote_reserves);
        if (capTokens <= 0n) {
          probes.delete(mint);
          continue;
        }
        if (orders.length >= cap) break;
        const amt = pos.token_amount < capTokens ? pos.token_amount : capTokens;
        orders.push({ side: 'sell', mint, token_amount: amt, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries and adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        let slipBps = p.buySlipBps;
        let isSnipe = false;
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          const mode = entryMode(t, now, rqSol);
          if (mode === null) continue;
          isSnipe = mode === 'snipe';
          if (isSnipe) {
            want = Math.min(p.snipeInitial, p.stakeSol);
            slipBps = p.snipeSlipBps;
          } else {
            want = Math.min(p.initialSol, p.stakeSol);
          }
        } else {
          // Sniper scalps never add: one tranche in, fast exit out.
          if (h.sniper) continue;
          // Pyramid into strength only: the position is up, the price stepped up from the last
          // add, and net SOL still flows in.
          if (h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.lastAddPrice * (1 + p.addStep)) continue;
          if (h.lastValue < Number(pos.cost_lamports) / LAMPORTS * (1 + p.addIfUp)) continue;
          if (flow(t, now, p.window) < p.addNetSol) continue;
          if (rqSol > p.maxRqSol) continue;
          want = Math.min(p.addSol, p.stakeSol - h.invested);
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: slipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, {
            opened: now,
            peakValue: 0,
            invested: amount,
            exiting: false,
            filled: false,
            lastAddPrice: price,
            lastValue: 0,
            tookTp1: false,
            tookTp2: false,
            devSoldAtOpen: t.devSold,
            sniper: isSnipe,
          });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * BPS_PER_UNIT) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
