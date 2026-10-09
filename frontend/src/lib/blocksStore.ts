"use client";

// The blocks library (smart lists and notes), loaded once and shared by
// view pages, the Add widget dialog and Settings → Blocks. The server is
// the source of truth; writes go through the API, then update this store.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Block } from "./types";

interface BlocksState {
  blocks: Block[];
  loaded: boolean;
  error: string | null;
}

const EMPTY: BlocksState = { blocks: [], loaded: false, error: null };
let state: BlocksState = EMPTY;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: BlocksState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshBlocks(): Promise<void> {
  pending = api
    .listBlocks()
    .then((r) => emit({ blocks: r.blocks, loaded: true, error: null }))
    .catch((e) => emit({ ...state, loaded: true, error: e instanceof Error ? e.message : "Couldn't load blocks" }))
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function putBlock(block: Block) {
  const exists = state.blocks.some((b) => b.id === block.id);
  emit({ ...state, blocks: exists ? state.blocks.map((b) => (b.id === block.id ? block : b)) : [...state.blocks, block] });
}

/** Replace a block only if the store still holds `expected` (that exact
 * object): a late or failed save must not undo a newer optimistic edit. */
export function putBlockIf(expected: Block, next: Block) {
  if (state.blocks.find((b) => b.id === expected.id) === expected) putBlock(next);
}

export function dropBlock(id: string) {
  emit({ ...state, blocks: state.blocks.filter((b) => b.id !== id) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBlocks(enabled = true): BlocksState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    if (enabled && !state.loaded && !pending) void refreshBlocks();
  }, [enabled]);
  return snapshot;
}
