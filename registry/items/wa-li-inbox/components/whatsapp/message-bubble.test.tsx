// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeMessage } from "../../../../test/inbox-factories";
import { MessageBubble } from "./message-bubble";
import { defaultInboxStrings } from "./strings";

function renderBubble(message: Parameters<typeof MessageBubble>[0]["message"]) {
  return render(
    <TooltipProvider>
      <MessageBubble message={message} />
    </TooltipProvider>,
  );
}

describe("<MessageBubble>", () => {
  it("shows the Meta error code and message of a failed send", () => {
    renderBubble(
      makeMessage({
        direction: "out",
        sender: "human",
        senderRef: "user-1",
        status: "failed",
        text: "Hola Sofía",
        error: { code: 131047, message: "Re-engagement message" },
      }),
    );
    expect(screen.getByText(/Código 131047 · Re-engagement message/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${defaultInboxStrings.tickFailed}: Código 131047 · Re-engagement message`,
      }),
    ).toBeInTheDocument();
  });

  it("labels the sender and shows a placeholder for media that failed to download", () => {
    renderBubble(
      makeMessage({
        type: "image",
        text: "Receta",
        media: { url: null, mimeType: "image/jpeg", sizeBytes: null, downloadStatus: "failed" },
      }),
    );
    expect(screen.getByText(defaultInboxStrings.senderContact)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: defaultInboxStrings.mediaUnavailable }),
    ).toBeInTheDocument();
    expect(screen.getByText("Receta")).toBeInTheDocument();
  });
});
