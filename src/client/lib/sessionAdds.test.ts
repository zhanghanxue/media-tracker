import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSessionAddedIds,
  recordSessionAdd,
  resetSessionAdds,
  subscribeSessionAdds,
} from "./sessionAdds";

beforeEach(() => {
  resetSessionAdds();
});

describe("sessionAdds store", () => {
  it("starts empty", () => {
    expect(getSessionAddedIds()).toEqual([]);
  });

  it("prepends new ids (newest first)", () => {
    recordSessionAdd(1);
    recordSessionAdd(2);
    recordSessionAdd(3);
    expect(getSessionAddedIds()).toEqual([3, 2, 1]);
  });

  it("dedupes an id that was already recorded (e.g. a 409 re-add)", () => {
    recordSessionAdd(1);
    recordSessionAdd(2);
    recordSessionAdd(1);
    expect(getSessionAddedIds()).toEqual([2, 1]);
  });

  it("returns the SAME snapshot reference until something changes", () => {
    recordSessionAdd(1);
    const a = getSessionAddedIds();
    const b = getSessionAddedIds();
    expect(a).toBe(b); // useSyncExternalStore requires snapshot stability
    recordSessionAdd(1); // no-op — must not churn the reference either
    expect(getSessionAddedIds()).toBe(a);
    recordSessionAdd(2);
    expect(getSessionAddedIds()).not.toBe(a);
  });

  it("notifies subscribers on change, and unsubscribes cleanly", () => {
    const cb = vi.fn();
    const unsub = subscribeSessionAdds(cb);
    recordSessionAdd(1);
    expect(cb).toHaveBeenCalledTimes(1);
    recordSessionAdd(1); // dedupe → no notify
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    recordSessionAdd(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
