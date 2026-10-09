// Playground only: a stand-in for https://connect.facebook.net/en_US/sdk.js so the numbers
// screen's Embedded Signup runs without Meta (fake Meta mode, see numbers-config.ts). FB.login
// asks for a phone_number_id in a prompt and answers like Embedded Signup v3: a
// WA_EMBEDDED_SIGNUP message (FINISH, or the coexistence FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING)
// plus a one-time code. Empty answer = cancel. lib/fake-meta.ts handles the server calls:
// ids ending in 0000 have a two-step PIN (123456); a code starting with "expired" fails.
(function () {
  "use strict";
  let sequence = 0;

  function post(event, data) {
    window.postMessage(
      JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: event, data: data, version: "3" }),
      window.location.origin,
    );
  }

  function randomId() {
    return (
      "7" + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0")
    );
  }

  window.FB = {
    init: function () {},
    login: function (callback, options) {
      const extras = (options && options.extras) || {};
      const coexistence = extras.featureType === "whatsapp_business_app_onboarding";
      const answer = window.prompt(
        "Embedded Signup de prueba (sin Meta)" +
          (coexistence ? " · app WhatsApp Business" : "") +
          "\nphone_number_id del número (termina en 0000 = pide el PIN 123456; vacío = cancelar):",
        randomId(),
      );
      if (!answer || !answer.trim()) {
        post("CANCEL", { current_step: "PHONE_NUMBER_SETUP" });
        callback({ authResponse: null, status: "unknown" });
        return;
      }
      const phoneNumberId = answer.trim();
      sequence += 1;
      post(coexistence ? "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" : "FINISH", {
        phone_number_id: phoneNumberId,
        waba_id: "5" + phoneNumberId.slice(1),
        business_id: "600000000000001",
      });
      setTimeout(function () {
        callback({
          authResponse: { code: "playground-code-" + String(Date.now()) + "-" + String(sequence) },
          status: "connected",
        });
      }, 50);
    },
  };

  if (typeof window.fbAsyncInit === "function") window.fbAsyncInit();
})();
