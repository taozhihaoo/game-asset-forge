import type { VisionProvider } from '../types.js';
import { AiError } from '../types.js';

/**
 * Local provider (V3 Feature 7 "Local"): interface placeholder only.
 * V3 ships no local runtime; the intended shape is an ONNX/sidecar process
 * (charter设想) enabled by an explicit local config. Any use throws —
 * callers must treat it as "AI unavailable" and continue without AI.
 */
export class LocalVisionProvider implements VisionProvider {
  readonly id = 'local';
  readonly model = 'local-reserved';

  async understand(): Promise<unknown> {
    throw new AiError(
      'AI_LOCAL_NOT_IMPLEMENTED',
      'local vision provider is reserved for a future version; use mock or a cloud provider',
    );
  }
}
