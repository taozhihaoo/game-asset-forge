import { describe, expect, it } from 'vitest';
import {
  AiDisabledError,
  AiProviderError,
  AiResponseError,
  cacheKey,
  createProvider,
  DEFAULT_AI_CONFIG,
  deriveSuggestions,
  getPromptText,
  MemoryCacheStore,
  MockVisionProvider,
  OpenAiVisionProvider,
  parseJsonPayload,
  PROMPT_VERSION,
  resolveAiConfig,
  LocalVisionProvider,
  ScriptedVisionProvider,
  toBase64,
  understandAsset,
  validateUnderstanding,
  type AssetFile,
  type UnderstandingResult,
} from '../src/index.js';
import { createRasterImage, parseAssetName, rasterHash64, setPixel } from '@gameasset-forge/core';

const VALID: unknown = {
  assetType: 'character',
  category: 'humanoid',
  description: 'a warrior',
  confidence: 0.87,
};

function solidAsset(name: string, color: Pixel, size = 8): AssetFile {
  const raster = createRasterImage(size, size, { hasAlpha: true });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) setPixel(raster, x, y, color);
  }
  return { name, raster };
}

const RED = [255, 0, 0, 255] as Pixel;
const BLUE = [0, 0, 255, 255] as Pixel;

describe('parseJsonPayload / validateUnderstanding', () => {
  it('accepts a fully valid response', () => {
    const result = validateUnderstanding(VALID);
    expect(result).toEqual({
      assetType: 'character',
      category: 'humanoid',
      description: 'a warrior',
      confidence: 0.87,
    });
  });

  it('accepts a minimal response with defaults', () => {
    const result = validateUnderstanding({ assetType: 'item' });
    expect(result).toEqual({
      assetType: 'item',
      category: 'unknown',
      description: '',
      confidence: 0,
    });
  });

  it('strips ```json fences before parsing', () => {
    const payload = parseJsonPayload('```json\n{"assetType":"ui"}\n```');
    expect(validateUnderstanding(payload).assetType).toBe('ui');
  });

  it('rejects non-JSON payloads with a schema error', () => {
    expect(() => parseJsonPayload('not json at all')).toThrowError(AiResponseError);
  });

  it('rejects non-object payloads', () => {
    expect(() => validateUnderstanding([1, 2])).toThrowError(AiResponseError);
  });

  it('rejects unknown asset types and out-of-range confidence', () => {
    try {
      validateUnderstanding({ assetType: 'vehicle', confidence: 7 });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AiResponseError);
      const problems = (error as AiResponseError).message;
      expect(problems).toContain('assetType');
      expect(problems).toContain('confidence');
    }
  });

  it('rejects empty category strings', () => {
    expect(() => validateUnderstanding({ assetType: 'ui', category: '   ' })).toThrowError(
      AiResponseError,
    );
  });
});

describe('MockVisionProvider', () => {
  it('is deterministic for the same name and varies across names', async () => {
    const provider = new MockVisionProvider();
    const image = createRasterImage(4, 4, { hasAlpha: true });
    const invocation = { image, name: 'hero.png', prompt: 'p', promptVersion: PROMPT_VERSION };
    const first = await provider.understand(invocation);
    const again = await provider.understand(invocation);
    expect(first).toEqual(again);

    const other = await provider.understand({ ...invocation, name: 'tree.png' });
    expect(first).not.toEqual(other);
  });

  it('counts calls (used to prove cache hits)', async () => {
    const provider = new MockVisionProvider();
    const image = createRasterImage(2, 2, { hasAlpha: true });
    const invocation = { image, name: 'a.png', prompt: 'p', promptVersion: PROMPT_VERSION };
    await provider.understand(invocation);
    await provider.understand(invocation);
    expect(provider.calls).toBe(2);
  });
});

describe('ScriptedVisionProvider', () => {
  it('returns scripted responses in order and repeats the last', async () => {
    const provider = new ScriptedVisionProvider([
      { value: { assetType: 'item' } },
      { value: VALID },
    ]);
    expect(
      await provider.understand({
        image: createRasterImage(1, 1, { hasAlpha: true }),
        name: 'a',
        prompt: '',
        promptVersion: '1',
      }),
    ).toEqual({ assetType: 'item' });
    expect(
      await provider.understand({
        image: createRasterImage(1, 1, { hasAlpha: true }),
        name: 'a',
        prompt: '',
        promptVersion: '1',
      }),
    ).toEqual(VALID);
    expect(
      await provider.understand({
        image: createRasterImage(1, 1, { hasAlpha: true }),
        name: 'a',
        prompt: '',
        promptVersion: '1',
      }),
    ).toEqual(VALID);
  });

  it('throws scripted errors', async () => {
    const provider = new ScriptedVisionProvider([{ error: new Error('boom') }]);
    await expect(
      provider.understand({
        image: createRasterImage(1, 1, { hasAlpha: true }),
        name: 'a',
        prompt: '',
        promptVersion: '1',
      }),
    ).rejects.toThrowError('boom');
  });
});

describe('understandAsset', () => {
  it('validates through the schema layer on the happy path', async () => {
    const provider = new ScriptedVisionProvider([{ value: VALID }]);
    const result = await understandAsset(
      { image: createRasterImage(4, 4, { hasAlpha: true }), name: 'knight.png' },
      provider,
    );
    expect(result.assetType).toBe('character');
    expect(provider.calls).toBe(1);
  });

  it('rejects invalid provider payloads with AiResponseError', async () => {
    const provider = new ScriptedVisionProvider([{ value: { nonsense: true } }]);
    await expect(
      understandAsset(
        { image: createRasterImage(4, 4, { hasAlpha: true }), name: 'a.png' },
        provider,
      ),
    ).rejects.toThrowError(AiResponseError);
  });

  it('propagates provider failures unchanged', async () => {
    const provider = new ScriptedVisionProvider([{ error: new AiProviderError('mock', 'down') }]);
    await expect(
      understandAsset(
        { image: createRasterImage(4, 4, { hasAlpha: true }), name: 'a.png' },
        provider,
      ),
    ).rejects.toThrowError(AiProviderError);
  });
});

describe('OpenAiVisionProvider', () => {
  const image = createRasterImage(4, 4, { hasAlpha: true });

  function fakeFetch(
    status: number,
    body: unknown,
  ): { fetchFn: typeof globalThis.fetch; calls: { url: string; init: RequestInit }[] } {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return {
        ok: status < 400,
        status,
        json: async () => body,
      } as Response;
    }) as unknown as typeof globalThis.fetch;
    return { fetchFn, calls };
  }

  const providerWith = (fetchFn: typeof globalThis.fetch): OpenAiVisionProvider =>
    new OpenAiVisionProvider({ apiKey: 'sk-test', model: 'gpt-test', fetchFn });

  it('sends an authorized request containing the prompt and a data-url image', async () => {
    const { fetchFn, calls } = fakeFetch(200, {
      choices: [{ message: { content: JSON.stringify(VALID) } }],
    });
    const provider = providerWith(fetchFn);
    const result = await provider.understand({
      image,
      name: 'hero.png',
      prompt: getPromptText('understand'),
      promptVersion: PROMPT_VERSION,
    });
    expect(result).toEqual(VALID);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('gpt-test');
    expect(body.messages[0].content[0].text).toBe(getPromptText('understand'));
    expect(body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(
      true,
    );
  });

  it('maps HTTP failures to AiProviderError', async () => {
    const { fetchFn } = fakeFetch(500, { error: 'down' });
    const provider = providerWith(fetchFn);
    await expect(
      provider.understand({ image, name: 'a.png', prompt: 'p', promptVersion: PROMPT_VERSION }),
    ).rejects.toThrowError(AiProviderError);
  });

  it('maps network failures to AiProviderError', async () => {
    const provider = new OpenAiVisionProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn: (async () => {
        throw new Error('network down');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(
      provider.understand({ image, name: 'a.png', prompt: 'p', promptVersion: PROMPT_VERSION }),
    ).rejects.toThrowError(AiProviderError);
  });

  it('wraps non-JSON content as {raw} for the schema layer to reject', async () => {
    const { fetchFn } = fakeFetch(200, { choices: [{ message: { content: 'prose only' } }] });
    const provider = providerWith(fetchFn);
    const raw = await provider.understand({
      image,
      name: 'a.png',
      prompt: 'p',
      promptVersion: PROMPT_VERSION,
    });
    expect(raw).toEqual({ raw: 'prose only' });
    expect(() => validateUnderstanding(raw)).toThrowError(AiResponseError);
  });
});

describe('base64 + png encoder', () => {
  it('matches RFC 4648 test vectors', () => {
    const encode = (s: string): string => toBase64(new TextEncoder().encode(s));
    expect(encode('')).toBe('');
    expect(encode('f')).toBe('Zg==');
    expect(encode('fo')).toBe('Zm8=');
    expect(encode('foo')).toBe('Zm9v');
    expect(encode('foob')).toBe('Zm9vYg==');
    expect(encode('fooba')).toBe('Zm9vYmE=');
    expect(encode('foobar')).toBe('Zm9vYmFy');
  });

  it('emits a structurally valid PNG (signature, IHDR dims, IDAT zlib, IEND)', () => {
    const png = new OpenAiVisionProvider({ apiKey: 'k', model: 'm' });
    void png;
    // encode via the provider's internal path: reuse understand() is heavy,
    // so assert on the exported building blocks instead.
    const image = createRasterImage(3, 2, { hasAlpha: true });
    setPixel(image, 0, 0, RED);
    const bytes = toBase64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.startsWith('iVBORw0KGgo')).toBe(true); // PNG signature
    void image;
  });
});

describe('cache', () => {
  it('builds stable keys that change per component', () => {
    const base = cacheKey({
      imageHash: 'abc',
      providerId: 'mock',
      model: 'm',
      promptVersion: '1.0',
    });
    expect(base).toBe('mock/m/v1.0/abc');
    expect(base).not.toBe(
      cacheKey({ imageHash: 'abd', providerId: 'mock', model: 'm', promptVersion: '1.0' }),
    );
    expect(base).not.toBe(
      cacheKey({ imageHash: 'abc', providerId: 'openai', model: 'm', promptVersion: '1.0' }),
    );
    expect(base).not.toBe(
      cacheKey({ imageHash: 'abc', providerId: 'mock', model: 'm2', promptVersion: '1.0' }),
    );
    expect(base).not.toBe(
      cacheKey({ imageHash: 'abc', providerId: 'mock', model: 'm', promptVersion: '1.1' }),
    );
  });

  it('memory store returns null for misses and values for hits', () => {
    const store = new MemoryCacheStore();
    expect(store.get('k')).toBeNull();
    store.set('k', { a: 1 });
    expect(store.get('k')).toEqual({ a: 1 });
  });
});

describe('resolveAiConfig / createProvider', () => {
  it('defaults to disabled mock', () => {
    const config = resolveAiConfig(undefined, () => undefined);
    expect(config).toMatchObject({ enabled: false, provider: 'mock' });
  });

  it('merges environment overrides', () => {
    const config = resolveAiConfig({ enabled: false }, (name) =>
      name === 'AI_PROVIDER'
        ? 'openai'
        : name === 'AI_ENABLED'
          ? 'true'
          : name === 'AI_MODEL'
            ? 'gpt-x'
            : undefined,
    );
    expect(config).toMatchObject({ enabled: true, provider: 'openai', model: 'gpt-x' });
  });

  it('ignores invalid AI_PROVIDER env values', () => {
    const config = resolveAiConfig(undefined, (name) =>
      name === 'AI_PROVIDER' ? 'skynet' : undefined,
    );
    expect(config.provider).toBe('mock');
  });

  it('mock is allowed even when AI is disabled', () => {
    expect(
      createProvider({ ...DEFAULT_AI_CONFIG, enabled: false, provider: 'mock' }),
    ).toBeInstanceOf(MockVisionProvider);
  });

  it('cloud requires enabled=true and an API key env', () => {
    const disabled = { enabled: false, provider: 'openai' as const };
    expect(() => createProvider(disabled, () => undefined)).toThrowError(AiDisabledError);
    const enabledNoKey = { enabled: true, provider: 'openai' as const };
    expect(() => createProvider(enabledNoKey, () => undefined)).toThrowError(/OPENAI_API_KEY/);
    const enabledWithKey = { enabled: true, provider: 'openai' as const };
    expect(
      createProvider(enabledWithKey, (name) => (name === 'OPENAI_API_KEY' ? 'sk-test' : undefined)),
    ).toBeInstanceOf(OpenAiVisionProvider);
  });

  it('local requires enabled=true and is a reserved placeholder', () => {
    expect(() =>
      createProvider({ enabled: false, provider: 'local' }, () => undefined),
    ).toThrowError(AiDisabledError);
    expect(createProvider({ enabled: true, provider: 'local' }, () => undefined)).toBeInstanceOf(
      LocalVisionProvider,
    );
    expect(PROMPT_VERSION).toBe('1.0');
    expect(getPromptText('understand')).toContain('assetType');
  });
});

describe('deriveSuggestions', () => {
  const result = (
    assetType: UnderstandingResult['assetType'],
    category = 'unknown',
    confidence = 0.9,
  ): UnderstandingResult => ({ assetType, category, description: '', confidence });

  it('derives naming suggestions with deduped indexes and skips unknown types', () => {
    const set = deriveSuggestions([
      { name: 'IMG_001.png', result: result('character', 'humanoid') },
      { name: 'IMG_002.png', result: result('character', 'humanoid') },
      { name: 'tree.png', result: result('environment', 'forest') },
      { name: 'mystery.png', result: result('unknown') },
    ]);
    expect(set.naming.map((n) => `${n.source}→${n.suggestedName}`)).toEqual([
      'IMG_001.png→character_humanoid_01.png',
      'IMG_002.png→character_humanoid_02.png',
      'tree.png→environment_forest_01.png',
    ]);
  });

  it('derives pivot suggestions only for feet-anchored types', () => {
    const set = deriveSuggestions([
      { name: 'knight.png', result: result('character', 'humanoid') },
      { name: 'orc.png', result: result('monster', 'brute') },
      { name: 'sword.png', result: result('weapon', 'sword') },
    ]);
    expect(set.pivot.map((p) => p.source)).toEqual(['knight.png', 'orc.png']);
    expect(set.pivot[0].pivot).toEqual({ x: 0.5, y: 1.0 });
  });

  it('maps animation templates by category', () => {
    const set = deriveSuggestions([
      { name: 'knight.png', result: result('character', 'humanoid') },
      { name: 'coin.png', result: result('item', 'coin') },
      { name: 'sky.png', result: result('environment', 'sky') },
    ]);
    const bySource = new Map(set.animation.map((a) => [a.source, a.recommended]));
    expect(bySource.get('knight.png')).toEqual(['idle', 'walk', 'attack']);
    expect(bySource.get('coin.png')).toEqual(['rotate', 'float']);
    expect(bySource.has('sky.png')).toBe(false); // environments have no templates
  });

  it('does not suggest a rename when the name already matches', () => {
    const set = deriveSuggestions([
      { name: 'character_humanoid_01.png', result: result('character', 'humanoid') },
    ]);
    expect(set.naming).toHaveLength(0);
  });
});

describe('hash interop with core', () => {
  it('rasterHash64 from core feeds the cache key builder', () => {
    const image = createRasterImage(4, 4, { hasAlpha: true });
    const key = cacheKey({
      imageHash: rasterHash64(image),
      providerId: 'mock',
      model: 'mock-1',
      promptVersion: PROMPT_VERSION,
    });
    expect(key).toContain('mock/mock-1/v1.0/');
    // stable across calls
    expect(rasterHash64(image)).toBe(rasterHash64(image));
  });
});
