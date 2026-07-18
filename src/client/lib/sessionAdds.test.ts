import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSessionAddedCollectionIds,
  getSessionAddedIds,
  recordSessionAdd,
  recordSessionCollectionAdd,
  resetSessionAdds,
  selectSessionMovedCollectionIds,
  selectSessionPins,
  subscribeSessionAdds,
  subscribeSessionCollectionAdds,
} from "./sessionAdds";
import type { MediaRow } from "./types";

function item(id: number, collectionId: string | null): MediaRow {
  return { id, collection_id: collectionId } as MediaRow;
}

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

describe("sessionAdds collection store", () => {
  it("starts empty and is independent of the media store", () => {
    recordSessionAdd(1);
    expect(getSessionAddedCollectionIds()).toEqual([]);
  });

  it("prepends new collection ids (newest first) and dedupes", () => {
    recordSessionCollectionAdd("a");
    recordSessionCollectionAdd("b");
    recordSessionCollectionAdd("a");
    expect(getSessionAddedCollectionIds()).toEqual(["b", "a"]);
  });

  it("keeps a stable snapshot reference and notifies subscribers", () => {
    const cb = vi.fn();
    const unsub = subscribeSessionCollectionAdds(cb);
    recordSessionCollectionAdd("a");
    expect(cb).toHaveBeenCalledTimes(1);
    const snap = getSessionAddedCollectionIds();
    recordSessionCollectionAdd("a"); // dedupe → no notify, no reference churn
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getSessionAddedCollectionIds()).toBe(snap);
    unsub();
    recordSessionCollectionAdd("b");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("resetSessionAdds clears both stores", () => {
    recordSessionAdd(1);
    recordSessionCollectionAdd("a");
    resetSessionAdds();
    expect(getSessionAddedIds()).toEqual([]);
    expect(getSessionAddedCollectionIds()).toEqual([]);
  });
});

describe("selectSessionPins", () => {
  it("returns pins in add order (newest first), not fetch order", () => {
    // ids are recorded newest-first; the server returns them in its own order.
    const ids = [3, 2, 1];
    const rows = [item(1, null), item(2, null), item(3, null)];
    expect(selectSessionPins(ids, rows).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("drops a pin whose row moved INTO a collection", () => {
    // The regression: item 2 was added loose, then assigned to a collection.
    // Its refetched row now has a collection_id, so it must NOT pin at root —
    // it belongs under its collection card instead.
    const ids = [2, 1];
    const rows = [item(1, null), item(2, "col:mcu")];
    expect(selectSessionPins(ids, rows).map((r) => r.id)).toEqual([1]);
  });

  it("drops a pin whose row is absent (deleted since add)", () => {
    const ids = [2, 1];
    const rows = [item(1, null)]; // row 2 was deleted, so it isn't returned
    expect(selectSessionPins(ids, rows).map((r) => r.id)).toEqual([1]);
  });

  it("keeps only loose rows when some moved and some were deleted", () => {
    const ids = [4, 3, 2, 1];
    const rows = [
      item(1, null), // loose → keep
      item(2, "col:x"), // moved → drop
      // row 3 deleted → absent → drop
      item(4, null), // loose → keep
    ];
    expect(selectSessionPins(ids, rows).map((r) => r.id)).toEqual([4, 1]);
  });

  it("returns [] for no ids", () => {
    expect(selectSessionPins([], [item(1, null)])).toEqual([]);
  });
});

describe("selectSessionMovedCollectionIds", () => {
  it("surfaces the collection a session-added item was moved into", () => {
    // The completing half of the fix: item 1 was dropped from the pins because
    // it now has a collection_id, so that collection must appear at Home instead.
    const ids = [1];
    const rows = [item(1, "col:mcu")];
    expect(selectSessionMovedCollectionIds(ids, rows)).toEqual(["col:mcu"]);
  });

  it("ignores loose rows and absent (deleted) rows", () => {
    const ids = [3, 2, 1];
    const rows = [item(1, "col:a"), item(2, null)]; // 3 deleted, 2 loose
    expect(selectSessionMovedCollectionIds(ids, rows)).toEqual(["col:a"]);
  });

  it("dedupes when several session items share one collection, newest-move first", () => {
    const ids = [3, 2, 1];
    const rows = [item(1, "col:a"), item(2, "col:b"), item(3, "col:a")];
    // id order is 3,2,1 → col:a (from 3), col:b (from 2), then 1's col:a is a dup
    expect(selectSessionMovedCollectionIds(ids, rows)).toEqual([
      "col:a",
      "col:b",
    ]);
  });

  it("returns [] when nothing has moved into a collection", () => {
    expect(
      selectSessionMovedCollectionIds([2, 1], [item(1, null), item(2, null)]),
    ).toEqual([]);
  });
});
