// @vitest-environment jsdom
/**
 * Polling fallback (AC-AP-4) is timer + visibility logic the playground E2E can't observe
 * reliably, so it is tested in isolation. Ways it could fail:
 * 1. Without realtime nothing polls, or the list/thread use the wrong intervals (10 s / 3 s).
 * 2. Polling keeps running while `document.hidden`, or doesn't resume (with an immediate
 *    refetch) when the tab is visible again.
 * 3. A channel that errors or times out leaves the inbox frozen (no polling), or polling keeps
 *    running after the channel subscribes, or with a healthy channel.
 * 4. Our own cleanup's CLOSED status switches a healthy inbox to polling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POLL_LIST_MS,
  POLL_THREAD_MS,
  useSendoRealtime,
  type UseSendoRealtimeOptions,
} from "./use-sendo-realtime";

function fakeClient() {
  let status: ((state: string) => void) | null = null;
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn((callback?: (state: string) => void) => {
      status = callback ?? null;
      return channel;
    }),
    emit: (state: string) => {
      act(() => status?.(state));
    },
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(() => Promise.resolve("ok")),
  };
  return { client, channel, asSupabase: client as unknown as SupabaseClient };
}

function options(client: SupabaseClient | null): UseSendoRealtimeOptions {
  return { client, tenantId: "tenant-1", onConversation: vi.fn(), onMessage: vi.fn() };
}

describe("useSendoRealtime", () => {
  it("does nothing with a null client", () => {
    const { client } = fakeClient();
    const { rerender, unmount } = renderHook(
      (props: UseSendoRealtimeOptions) => {
        useSendoRealtime(props);
      },
      { initialProps: options(null) },
    );
    rerender({ ...options(null), conversationId: "conv-1" });
    unmount();
    expect(client.channel).not.toHaveBeenCalled();
    expect(client.removeChannel).not.toHaveBeenCalled();
  });

  it("subscribes to conversations and messages filtered by tenant and removes the channel on unmount", () => {
    const { client, channel, asSupabase } = fakeClient();
    const { unmount } = renderHook(() => {
      useSendoRealtime(options(asSupabase));
    });
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "sendo_conversations", filter: "tenant_id=eq.tenant-1" }),
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "sendo_messages", filter: "tenant_id=eq.tenant-1" }),
      expect.any(Function),
    );
    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe("useSendoRealtime polling fallback", () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setHidden = (value: boolean) => {
    hidden = value;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  function render(client: SupabaseClient | null) {
    const onPollList = vi.fn();
    const onPollThread = vi.fn();
    const props: UseSendoRealtimeOptions = {
      ...options(client),
      conversationId: "conv-1",
      onPollList,
      onPollThread,
    };
    const view = renderHook(
      (p: UseSendoRealtimeOptions) => {
        useSendoRealtime(p);
      },
      { initialProps: props },
    );
    return { ...view, props, onPollList, onPollThread };
  }

  it("1. polls the list every 10 s and the open thread every 3 s without a client", () => {
    const { onPollList, onPollThread, rerender, props } = render(null);
    vi.advanceTimersByTime(POLL_THREAD_MS);
    expect(onPollThread).toHaveBeenCalledTimes(1);
    expect(onPollThread).toHaveBeenLastCalledWith("conv-1");
    expect(onPollList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(POLL_LIST_MS - POLL_THREAD_MS);
    expect(onPollList).toHaveBeenCalledTimes(1);
    expect(onPollThread).toHaveBeenCalledTimes(3);

    rerender({ ...props, conversationId: null });
    vi.advanceTimersByTime(POLL_LIST_MS);
    expect(onPollThread).toHaveBeenCalledTimes(3);
    expect(onPollList).toHaveBeenCalledTimes(2);
  });

  it("2. stops while the tab is hidden and refetches at once when it is visible again", () => {
    const { onPollList, onPollThread } = render(null);
    setHidden(true);
    vi.advanceTimersByTime(5 * POLL_LIST_MS);
    expect(onPollList).not.toHaveBeenCalled();
    expect(onPollThread).not.toHaveBeenCalled();

    setHidden(false);
    expect(onPollList).toHaveBeenCalledTimes(1);
    expect(onPollThread).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_LIST_MS);
    expect(onPollList).toHaveBeenCalledTimes(2);
    expect(onPollThread).toHaveBeenCalledTimes(1 + Math.floor(POLL_LIST_MS / POLL_THREAD_MS));
  });

  it("3. polls while the channel is down and stops once it subscribes", () => {
    const { channel, asSupabase } = fakeClient();
    const { onPollList, onPollThread } = render(asSupabase);
    vi.advanceTimersByTime(POLL_LIST_MS);
    expect(onPollList).not.toHaveBeenCalled();
    expect(onPollThread).not.toHaveBeenCalled();

    channel.emit("CHANNEL_ERROR");
    vi.advanceTimersByTime(POLL_LIST_MS);
    expect(onPollList).toHaveBeenCalledTimes(1);

    channel.emit("SUBSCRIBED");
    vi.advanceTimersByTime(3 * POLL_LIST_MS);
    expect(onPollList).toHaveBeenCalledTimes(1);

    channel.emit("TIMED_OUT");
    vi.advanceTimersByTime(POLL_THREAD_MS);
    expect(onPollThread).toHaveBeenCalled();
  });

  it("4. closing its own channel on cleanup does not switch to polling", () => {
    const { channel, asSupabase } = fakeClient();
    const { onPollList, rerender, props } = render(asSupabase);
    channel.emit("SUBSCRIBED");
    rerender({ ...props, conversationId: "conv-2" });
    // The new channel subscribes, then the first one reports CLOSED after its cleanup.
    channel.emit("SUBSCRIBED");
    const first = channel.subscribe.mock.calls[0]?.[0];
    act(() => first?.("CLOSED"));
    vi.advanceTimersByTime(3 * POLL_LIST_MS);
    expect(onPollList).not.toHaveBeenCalled();
  });
});
