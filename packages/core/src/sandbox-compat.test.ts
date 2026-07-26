import { afterEach, describe, expect, it } from "vitest";
import { ensureSafeAsyncScheduling } from "./sandbox-compat";

type SandboxWindow = Window & {
  __POWERED_BY_QIANKUN__?: boolean;
  setImmediate?: (callback: (...args: unknown[]) => void, ...args: unknown[]) => number;
  clearImmediate?: (handle: number) => void;
};

const win = window as unknown as SandboxWindow;
const originalSetImmediate = win.setImmediate;
const originalClearImmediate = win.clearImmediate;

afterEach(() => {
  delete win.__POWERED_BY_QIANKUN__;
  win.setImmediate = originalSetImmediate;
  win.clearImmediate = originalClearImmediate;
});

describe("ensureSafeAsyncScheduling", () => {
  it("leaves the window untouched outside micro-frontend sandboxes", () => {
    const broken = () => 0;
    win.setImmediate = broken;
    ensureSafeAsyncScheduling();
    expect(win.setImmediate).toBe(broken);
  });

  it("replaces a broken setImmediate under a qiankun sandbox", async () => {
    win.__POWERED_BY_QIANKUN__ = true;
    // Simulates the setimmediate polyfill after qiankun removed its message listener.
    win.setImmediate = () => 0;
    ensureSafeAsyncScheduling();

    await new Promise<void>((resolve) => {
      win.setImmediate!(() => resolve());
    });
  });

  it("passes arguments through and supports clearImmediate", async () => {
    win.__POWERED_BY_QIANKUN__ = true;
    ensureSafeAsyncScheduling();

    const received = await new Promise<unknown[]>((resolve) => {
      win.setImmediate!((...args: unknown[]) => resolve(args), "a", 2);
    });
    expect(received).toEqual(["a", 2]);

    let cancelledRan = false;
    const handle = win.setImmediate!(() => {
      cancelledRan = true;
    });
    win.clearImmediate!(handle);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelledRan).toBe(false);
  });

  it("is idempotent", () => {
    win.__POWERED_BY_QIANKUN__ = true;
    ensureSafeAsyncScheduling();
    const installed = win.setImmediate;
    ensureSafeAsyncScheduling();
    expect(win.setImmediate).toBe(installed);
  });
});
