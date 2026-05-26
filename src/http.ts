import { RUNTIME_CONFIG } from './config.js';

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = RUNTIME_CONFIG.upstreamTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let removeAbortListener: (() => void) | undefined;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      const onAbort = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => upstreamSignal.removeEventListener('abort', onAbort);
    }
  }

  const timeout = setTimeout(() => {
    controller.abort(new Error(`upstream timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error(`upstream timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    removeAbortListener?.();
  }
}
