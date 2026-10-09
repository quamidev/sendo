// @vitest-environment jsdom
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSendoRealtime, type UseSendoRealtimeOptions } from "./use-sendo-realtime";

function fakeClient() {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
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
