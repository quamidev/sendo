import { wa } from "./whatsapp";

export async function examples(file: Blob) {
  // #region send
  // Numbers are normalized to E.164: "+502 5555-1234" and "50255551234" both work.
  const message = await wa.send.text("+502 5555-1234", "Hola, tu cita está confirmada.", {
    previewUrl: false,
  });
  console.log(message.id, message.metaMessageId, message.status); // "sent"

  await wa.send.media("50255551234", { type: "image", url: "https://example.com/receta.png" });
  await wa.send.media("50255551234", { type: "document", file, filename: "factura.pdf" });

  await wa.send.buttons("50255551234", {
    body: "¿Confirmas tu cita de mañana a las 10:00?",
    buttons: [
      { id: "confirmar", title: "Confirmar" },
      { id: "reprogramar", title: "Reprogramar" },
    ],
    footer: "Clínica Central",
  });

  await wa.send.list("50255551234", {
    body: "Elige un servicio",
    button: "Ver servicios",
    sections: [
      {
        title: "Consultas",
        rows: [
          { id: "general", title: "Medicina general" },
          { id: "pediatria", title: "Pediatría", description: "Lunes a viernes" },
        ],
      },
    ],
  });

  // Templates work outside the 24-hour window. Positional {{1}} or named {{nombre}} variables.
  await wa.send.template("50255551234", "recordatorio_cita", {
    language: "es",
    variables: ["Ana", "mañana 10:00"],
  });

  await wa.send.markRead("wamid.HBgLNTAy..."); // wa-li id or Meta id of an inbound message
  // #endregion send
}
