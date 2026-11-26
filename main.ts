// Supply-Cleanse Velocity Compounder: a pump.fun paper-trading bot for the
// agent-fun/replay/v2 harness. The strategy lives in strategy.ts and the SDK shim is the
// kit's sdk/ts/makefun-bot.ts, vendored byte for byte.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
