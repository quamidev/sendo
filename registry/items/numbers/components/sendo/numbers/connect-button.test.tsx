// @vitest-environment jsdom
/**
 * The connect button drives Embedded Signup through a fake `FB` global (no network), the
 * same way Meta's SDK answers: a `WA_EMBEDDED_SIGNUP` message event plus the `FB.login`
 * callback. Covers AC-ES-1 / AC-CX-1 and the Flow B failure states the button owns.
 *
 * [CB-1] success: FB.login gets the v3 options; code + waba_id + phone_number_id reach `connect`.
 * [CB-2] coexistence flavour: `featureType` is sent and `coexistence: true` reaches `connect`.
 * [CB-3] cancel: neutral toast, `connect` is never called.
 * [CB-4] PIN conflict: asks for the 6-digit PIN, opens Meta again, retries with the new code and PIN.
 * [CB-5] security boundary: session info posted from a non-Meta origin is ignored.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast, Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FacebookLoginOptions,
  FacebookLoginResponse,
  FacebookSdk,
} from "@/lib/sendo-embedded-signup";
import { ConnectButton } from "./connect-button";
import type { ConnectNumberInput, NumbersActionResult, NumbersMutation, NumberView } from "./types";

const CONFIG = { appId: "app-1", configId: "config-1", graphVersion: "v26.0" };

interface LoginCall {
  options: FacebookLoginOptions;
  callback: (response: FacebookLoginResponse) => void;
}

function postSession(
  event: string,
  data: Record<string, unknown>,
  origin = "https://www.facebook.com",
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data, version: "3" }),
    }),
  );
}

function installFakeFacebook(): LoginCall[] {
  const calls: LoginCall[] = [];
  const sdk: FacebookSdk = {
    init: vi.fn(),
    login: (callback, options) => {
      calls.push({ callback, options });
    },
  };
  window.FB = sdk;
  return calls;
}

function view(id: string, phone: string): NumberView {
  return {
    id,
    channel: "whatsapp",
    label: null,
    displayPhone: phone,
    phoneNumberId: "PN-1",
    wabaId: "WABA-1",
    active: true,
    isDefault: true,
    coexistence: false,
    onboardedVia: "embedded_signup",
    agentPaused: false,
    agentMode: null,
    billingReady: true,
    billingCheckedAt: null,
    tokenInvalid: false,
    createdAt: new Date(0).toISOString(),
  };
}

function connected(): NumbersActionResult<NumbersMutation> {
  return { ok: true, data: { id: "acc-1", numbers: [view("acc-1", "+502 2200 1001")] } };
}

function renderButton(
  onConnect: (input: ConnectNumberInput) => Promise<NumbersActionResult<NumbersMutation>>,
) {
  const onConnected = vi.fn();
  render(
    <>
      <ConnectButton
        config={CONFIG}
        mode={{ kind: "new", first: true }}
        onConnect={onConnect}
        onConnected={onConnected}
        metaRequirementsUrl="https://sendo.dev/docs/embedded-signup"
      />
      <Toaster />
    </>,
  );
  return { onConnected };
}

async function openMeta(choice: RegExp) {
  const button = await screen.findByRole("button", { name: "Conectar WhatsApp" });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: choice }));
}

beforeEach(() => {
  delete window.FB;
});

afterEach(() => {
  delete window.FB;
  toast.dismiss();
});

describe("<ConnectButton> with a fake Facebook SDK", () => {
  it("[CB-1] sends the code and session info of a finished signup to the connect action", async () => {
    const calls = installFakeFacebook();
    const onConnect = vi.fn(() => Promise.resolve(connected()));
    const { onConnected } = renderButton(onConnect);

    await openMeta(/Un número nuevo/);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("FB.login not called");
    expect(call.options).toEqual({
      config_id: "config-1",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: "3" },
    });

    act(() => {
      postSession("FINISH", { phone_number_id: "PN-1", waba_id: "WABA-1", business_id: "B-1" });
      call.callback({ authResponse: { code: "code-1" }, status: "connected" });
    });

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith({
        code: "code-1",
        wabaId: "WABA-1",
        phoneNumberId: "PN-1",
        coexistence: false,
      });
    });
    expect(await screen.findAllByText("+502 2200 1001 conectado")).not.toHaveLength(0);
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ id: "acc-1" }));
  });

  it("[CB-2] starts the WhatsApp Business app (coexistence) flavour", async () => {
    const calls = installFakeFacebook();
    const onConnect = vi.fn(() => Promise.resolve(connected()));
    renderButton(onConnect);

    await openMeta(/El número que ya usas en el teléfono/);
    const call = calls[0];
    if (call === undefined) throw new Error("FB.login not called");
    expect(call.options.extras).toEqual({
      setup: {},
      sessionInfoVersion: "3",
      featureType: "whatsapp_business_app_onboarding",
    });

    act(() => {
      call.callback({ authResponse: { code: "code-2" } });
      postSession("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", {
        phone_number_id: "PN-2",
        waba_id: "WABA-2",
      });
    });

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith({
        code: "code-2",
        wabaId: "WABA-2",
        phoneNumberId: "PN-2",
        coexistence: true,
      });
    });
  });

  it("[CB-3] a cancelled popup shows a neutral toast and creates nothing", async () => {
    const calls = installFakeFacebook();
    const onConnect = vi.fn(() => Promise.resolve(connected()));
    renderButton(onConnect);

    await openMeta(/Un número nuevo/);
    act(() => {
      postSession("CANCEL", { current_step: "PHONE_NUMBER_SETUP" });
      calls[0]?.callback({ authResponse: null, status: "unknown" });
    });

    expect(await screen.findByText("Conexión cancelada. No se creó nada.")).toBeInTheDocument();
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Conectar WhatsApp" })).toBeEnabled();
  });

  it("[CB-4] asks for the two-step PIN and opens Meta again with a new code", async () => {
    const calls = installFakeFacebook();
    const onConnect = vi
      .fn<(input: ConnectNumberInput) => Promise<NumbersActionResult<NumbersMutation>>>()
      .mockResolvedValueOnce({ ok: false, code: "PIN_CONFLICT", message: "PIN" })
      .mockResolvedValueOnce(connected());
    renderButton(onConnect);

    await openMeta(/Un número nuevo/);
    act(() => {
      postSession("FINISH", { phone_number_id: "PN-3", waba_id: "WABA-3" });
      calls[0]?.callback({ authResponse: { code: "code-first" } });
    });

    const pin = await screen.findByLabelText("PIN de 6 dígitos");
    fireEvent.change(pin, { target: { value: "12a3" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar con el PIN" }));
    expect(await screen.findByText("El PIN tiene 6 dígitos.")).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    fireEvent.change(pin, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar con el PIN" }));
    expect(calls).toHaveLength(2);
    act(() => {
      postSession("FINISH", { phone_number_id: "PN-3", waba_id: "WABA-3" });
      calls[1]?.callback({ authResponse: { code: "code-second" } });
    });

    await waitFor(() => {
      expect(onConnect).toHaveBeenLastCalledWith({
        code: "code-second",
        wabaId: "WABA-3",
        phoneNumberId: "PN-3",
        coexistence: false,
        pin: "123456",
      });
    });
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(await screen.findAllByText("+502 2200 1001 conectado")).not.toHaveLength(0);
  });

  it("[CB-5] ignores session info from origins other than Meta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls = installFakeFacebook();
      const onConnect = vi.fn(() => Promise.resolve(connected()));
      renderButton(onConnect);

      await openMeta(/Un número nuevo/);
      act(() => {
        postSession(
          "FINISH",
          { phone_number_id: "EVIL", waba_id: "EVIL" },
          "https://evil-facebook.com",
        );
        postSession(
          "FINISH",
          { phone_number_id: "EVIL", waba_id: "EVIL" },
          "http://www.facebook.com",
        );
        calls[0]?.callback({ authResponse: { code: "code-5" } });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000);
      });

      expect(onConnect).not.toHaveBeenCalled();
      expect(
        await screen.findByText("Meta no pudo completar la conexión. Intenta de nuevo."),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
