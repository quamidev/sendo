// @vitest-environment jsdom
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWhatsAppRealtime, type UseWhatsAppRealtimeOptions } from "./use-whatsapp-realtime";

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

function options(client: SupabaseClient | null): UseWhatsAppRealtimeOptions {
  return { client, tenantId: "tenant-1", onConversation: vi.fn(), onMessage: vi.fn() };
}

describe("useWhatsAppRealtime", () => {
  it("does nothing with a null client", () => {
    const { client } = fakeClient();
    const { rerender, unmount } = renderHook(
      (props: UseWhatsAppRealtimeOptions) => {
        useWhatsAppRealtime(props);
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
      useWhatsAppRealtime(options(asSupabase));
    });
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "wa_conversations", filter: "tenant_id=eq.tenant-1" }),
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "wa_messages", filter: "tenant_id=eq.tenant-1" }),
      expect.any(Function),
    );
    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("filters messages by the open conversation", () => {
    const { channel, asSupabase } = fakeClient();
    renderHook(() => {
      useWhatsAppRealtime({ ...options(asSupabase), conversationId: "conv-9" });
    });
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "wa_messages", filter: "conversation_id=eq.conv-9" }),
      expect.any(Function),
    );
  });
});
