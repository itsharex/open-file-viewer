const SAFE_SET_IMMEDIATE_FLAG = "__ofvSafeSetImmediate__";

type ImmediateCallback = (...args: unknown[]) => void;

type ImmediateWindow = Window & {
  setImmediate?: ((callback: ImmediateCallback, ...args: unknown[]) => number) & { [SAFE_SET_IMMEDIATE_FLAG]?: boolean };
  clearImmediate?: (handle: number) => void;
};

function isMicroFrontendSandbox(win: Window): boolean {
  const flags = win as unknown as Record<string, unknown>;
  return Boolean(
    flags.__POWERED_BY_QIANKUN__ ||
      flags.__MICRO_APP_ENVIRONMENT__ ||
      flags.__POWERED_BY_WUJIE__ ||
      flags.__GARFISH__
  );
}

function createScheduler(win: Window): { schedule: (callback: ImmediateCallback, args: unknown[]) => number; cancel: (handle: number) => void } {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();

  // MessageChannel ports are private to this module, so micro-frontend sandboxes
  // that tear down window "message" listeners on unmount cannot break them.
  const MessageChannelCtor = (win as Window & { MessageChannel?: typeof MessageChannel }).MessageChannel;
  if (typeof MessageChannelCtor === "function") {
    const channel = new MessageChannelCtor();
    channel.port1.onmessage = (event: MessageEvent) => {
      const task = pending.get(event.data as number);
      if (task) {
        pending.delete(event.data as number);
        task();
      }
    };
    return {
      schedule(callback, args) {
        const handle = nextHandle++;
        pending.set(handle, () => callback(...args));
        channel.port2.postMessage(handle);
        return handle;
      },
      cancel(handle) {
        pending.delete(handle);
      }
    };
  }

  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    schedule(callback, args) {
      const handle = nextHandle++;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          callback(...args);
        }, 0)
      );
      return handle;
    },
    cancel(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle);
      }
    }
  };
}

/**
 * Micro-frontend sandboxes (qiankun, micro-app, ...) tear down the window
 * "message" listener that the `setimmediate` polyfill bundled with JSZip relies
 * on, so every `setImmediate` callback silently stops firing and zip-backed
 * previews (docx/xlsx/pptx/epub/ofd...) hang on the loading state forever.
 * Installing a scheduler that does not depend on window listeners restores them.
 */
export function ensureSafeAsyncScheduling(win: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!win || !isMicroFrontendSandbox(win)) {
    return;
  }
  const target = win as ImmediateWindow;
  if (target.setImmediate?.[SAFE_SET_IMMEDIATE_FLAG]) {
    return;
  }
  const scheduler = createScheduler(win);
  const safeSetImmediate = ((callback: ImmediateCallback, ...args: unknown[]) => scheduler.schedule(callback, args)) as NonNullable<
    ImmediateWindow["setImmediate"]
  >;
  safeSetImmediate[SAFE_SET_IMMEDIATE_FLAG] = true;
  target.setImmediate = safeSetImmediate;
  target.clearImmediate = (handle: number) => scheduler.cancel(handle);
}
