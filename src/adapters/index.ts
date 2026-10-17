/**
 * Adapters by name. A bots/<id>.json names its adapter here; a dry run swaps
 * every adapter for the fake bot wearing that bot's shape.
 */
import type { Adapter, BotConfig } from '../adapter.ts';
import { FakeAdapter, type FakeOptions } from './fake.ts';
import { MeleteAdapter } from './melete.ts';
import { OpenMausBotAdapter } from './openmausbot.ts';

export type LiveOptions = { scale: number; env: Record<string, string | undefined> };

export const ADAPTERS: Record<string, (config: BotConfig, opts: LiveOptions) => Adapter> = {
  melete: (config, opts) => new MeleteAdapter(config, opts),
  openmausbot: (config, opts) => new OpenMausBotAdapter(config, opts),
};

export function liveAdapter(config: BotConfig, opts: LiveOptions): Adapter {
  const make = ADAPTERS[config.adapter];
  if (!make) throw new Error(`bots/${config.id}.json names adapter "${config.adapter}", which src/adapters/index.ts does not register (known: ${Object.keys(ADAPTERS).join(', ')}).`);
  return make(config, opts);
}

/** The fake bot in the shape of a real one: the shape is the bot's adapter when the fake knows it, else melete's. */
export function fakeAdapter(config: BotConfig, opts: Omit<FakeOptions, 'shape' | 'config'> & { shape?: FakeOptions['shape'] }): FakeAdapter {
  const shape = opts.shape ?? (config.adapter === 'openmausbot' ? 'openmausbot' : 'melete');
  return new FakeAdapter({ ...opts, shape, config });
}
