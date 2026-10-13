// @vitest-environment jsdom
/**
 * The typed rule forms against the package's zod schemas (`ruleParamsSchemas`), driven through
 * the rendered editor like an admin would. `onSave` is the boundary: it must receive exactly the
 * params `sendo.rules.upsert` stores, and never anything the schema rejects.
 *
 * Ways it could fail (one test each):
 * 1. business_hours: an end-before-start range, an unknown time zone or an empty after-hours message
 *    reaches onSave instead of the schema's Spanish message at that field.
 * 2. business_hours: a valid week (two ranges on Monday, closed weekend, a holiday, appliesTo "all")
 *    is saved with different params (ranges lost or merged, closed days not `[]`, holidays dropped).
 * 3. route: a malformed source code is accepted; a valid route puts keywords, source, queue, tags,
 *    `to` and reason in the wrong match/action slot, or saves empty optional fields.
 * 4. auto_assign: "Una cola" with a blank name is accepted; "Sin cola" is saved as omitted (every
 *    queue) instead of `null` (only conversations without a queue).
 * 5. escalate: 0, 1.5 or "quince" minutes are accepted, or shown with zod's English text.
 * 6. auto_close: 400 days is accepted; a valid value is saved as the string "7", not the number 7.
 * 7. Name: a blank name or one another rule uses is accepted (upsert by key would overwrite it).
 * 8. A server-side INVALID with field errors closes the sheet or isn't shown at the field.
 * 9. An invalid stored rule crashes the list or the editor instead of an error row and a form that
 *    marks the bad fields.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuleEditor } from "./rule-editor";
import { RulesScreen } from "./rules-screen";
import { defaultWorkflowsStrings as strings } from "./strings";
import type {
  RuleNumberView,
  RuleRowView,
  RulesActions,
  SaveRuleInput,
  WorkflowsActionResult,
} from "./types";

const NUMBERS: RuleNumberView[] = [
  {
    id: "acc-1",
    label: "Recepción",
    displayPhone: "+502 2222 3333",
    phoneNumberId: "1001",
    active: true,
  },
];

type Save = (input: SaveRuleInput) => Promise<WorkflowsActionResult<unknown>>;

function renderEditor(options: {
  type?: SaveRuleInput["type"];
  rule?: RuleRowView | null;
  save?: Save;
  takenKeys?: string[];
}) {
  const onSave = vi.fn<Save>(options.save ?? (() => Promise.resolve({ ok: true, data: [] })));
  const onOpenChange = vi.fn();
  render(
    <RuleEditor
      open
      rule={options.rule ?? null}
      initialType={options.type ?? "business_hours"}
      numbers={NUMBERS}
      takenKeys={options.takenKeys ?? []}
      strings={strings}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />,
  );
  return { onSave, onOpenChange };
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: strings.save }));
}

/** The error paragraph linked to a control through `aria-describedby`. */
function errorOf(label: string | RegExp): string | null {
  const control = screen.getByLabelText(label);
  const ids = control.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = ids
    .map((id) => document.getElementById(id))
    .find((node) => node?.id.endsWith("-error"));
  return error?.textContent ?? null;
}

function savedInput(onSave: ReturnType<typeof renderEditor>["onSave"]): SaveRuleInput {
  expect(onSave).toHaveBeenCalledTimes(1);
  const input = onSave.mock.calls[0]?.[0];
  if (input === undefined) throw new Error("onSave not called");
  return input;
}

// These tests type whole forms with user-event; under a parallel `turbo test` a single test can
// take longer than vitest's 5 s default without anything being wrong.
describe("rule editor validation (package schemas)", { timeout: 30_000 }, () => {
  it("1. business_hours: rejects an inverted range, an unknown time zone and an empty message", async () => {
    const { onSave } = renderEditor({ type: "business_hours" });
    type(strings.keyLabel, "Horario oficina");
    type(strings.timezoneLabel, "America/Ciudad_Inventada");
    type("Lunes, inicio del tramo 1", "18:00");
    type("Lunes, fin del tramo 1", "09:00");
    save();

    expect(errorOf(strings.timezoneLabel)).toBe("Zona horaria IANA desconocida.");
    expect(errorOf(strings.outsideMessageLabel)).toBe("No puede estar vacío.");
    expect(await screen.findByText("El inicio debe ser anterior al fin.")).toBeInTheDocument();
    expect(screen.getByLabelText("Lunes, inicio del tramo 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText(strings.fixErrors)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    type("Lunes, inicio del tramo 1", "9:00");
    expect(screen.getAllByText("Usa HH:MM (00:00–24:00).").length).toBeGreaterThan(0);
  });

  it("2. business_hours: saves a multi-range week with holidays exactly", async () => {
    const { onSave } = renderEditor({ type: "business_hours" });
    type(strings.keyLabel, "Horario oficina");
    type(strings.timezoneLabel, "America/Guatemala");
    type("Lunes, fin del tramo 1", "13:00");
    fireEvent.click(screen.getByRole("button", { name: strings.addRangeLabel("Lunes") }));
    type("Lunes, inicio del tramo 2", "14:00");
    type("Lunes, fin del tramo 2", "24:00");
    fireEvent.click(screen.getByRole("button", { name: strings.copyMondayToWeekdays }));
    fireEvent.click(screen.getByRole("switch", { name: strings.openDay("Viernes") }));
    type(strings.holidayInputLabel, "2026-12-25");
    fireEvent.click(screen.getByRole("button", { name: strings.addHoliday }));
    type(strings.outsideMessageLabel, "Hola, abrimos de lunes a jueves a las 9:00.");
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(strings.appliesToOptions.all.label) }),
    );
    save();

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const monday: [string, string][] = [
      ["09:00", "13:00"],
      ["14:00", "24:00"],
    ];
    expect(savedInput(onSave)).toEqual({
      id: null,
      key: "Horario oficina",
      type: "business_hours",
      account: null,
      params: {
        timezone: "America/Guatemala",
        schedule: { mon: monday, tue: monday, wed: monday, thu: monday, fri: [], sat: [], sun: [] },
        holidays: ["2026-12-25"],
        outsideMessage: "Hola, abrimos de lunes a jueves a las 9:00.",
        appliesTo: "all",
      },
    });
  });

  it("3. route: rejects a malformed source and saves match/action in the right slots", async () => {
    const { onSave } = renderEditor({ type: "route" });
    type(strings.keyLabel, "Cobranza");
    type(strings.sourceLabel, "Garita Norte");
    save();
    expect(errorOf(strings.sourceLabel)).toBe("Código de origen inválido.");
    expect(onSave).not.toHaveBeenCalled();

    type(strings.sourceLabel, "factura");
    type(strings.keywordsLabel, "Pago, cobro,");
    type(strings.routeQueueLabel, "cobranza");
    type(strings.tagsLabel, "urgente,");
    type(strings.reasonLabel, "Pregunta por su cuenta");
    save();

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(savedInput(onSave).params).toEqual({
      match: { source: "factura", keywords: ["Pago", "cobro"] },
      action: {
        queue: "cobranza",
        tags: ["urgente"],
        to: "human",
        reason: "Pregunta por su cuenta",
      },
    });
  });

  it("4. auto_assign: a named queue needs a name; 'Sin cola' saves null", async () => {
    const { onSave } = renderEditor({ type: "auto_assign" });
    type(strings.keyLabel, "Reparto");
    fireEvent.click(screen.getByRole("radio", { name: strings.queueModes.named }));
    save();
    expect(screen.getByText("No puede estar vacío.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: strings.queueModes.none }));
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(strings.strategyLabels.round_robin) }),
    );
    save();
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(savedInput(onSave).params).toEqual({ queue: null, strategy: "round_robin" });
  });

  it("5. escalate: minutes must be a whole number from 1, with Spanish messages", async () => {
    const { onSave } = renderEditor({ type: "escalate" });
    type(strings.keyLabel, "Sin respuesta");
    const cases: [string, string][] = [
      ["0", "Mínimo 1."],
      ["1.5", "Usa un número entero."],
      ["quince", "Escribe un número."],
      ["", "Obligatorio."],
      ["20000", "Máximo 10.080."],
    ];
    for (const [value, message] of cases) {
      type(strings.afterMinutesLabel, value);
      save();
      expect(errorOf(strings.afterMinutesLabel)).toBe(message);
    }
    expect(onSave).not.toHaveBeenCalled();

    type(strings.afterMinutesLabel, "30");
    fireEvent.click(screen.getByRole("radio", { name: /Avisar/ }));
    save();
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(savedInput(onSave).params).toEqual({ afterMinutes: 30, action: "notify" });
  });

  it("6. auto_close: rejects 400 days and saves a number", async () => {
    const { onSave } = renderEditor({ type: "auto_close" });
    type(strings.keyLabel, "Cierre automático");
    type(strings.afterDaysLabel, "400");
    save();
    expect(errorOf(strings.afterDaysLabel)).toBe("Máximo 365.");
    expect(onSave).not.toHaveBeenCalled();

    type(strings.afterDaysLabel, "7");
    save();
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(savedInput(onSave)).toMatchObject({
      key: "Cierre automático",
      type: "auto_close",
      params: { afterDays: 7 },
    });
  });

  it("7. name: blank and duplicate names are rejected", () => {
    const { onSave } = renderEditor({ type: "auto_close", takenKeys: ["Cierre automático"] });
    save();
    expect(errorOf(strings.keyLabel)).toBe("No puede estar vacío.");
    type(strings.keyLabel, "Cierre automático");
    expect(errorOf(strings.keyLabel)).toBe(strings.keyDuplicate);
    save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("8. shows server field errors at the field and keeps the sheet open", async () => {
    const { onSave, onOpenChange } = renderEditor({
      type: "auto_close",
      save: () =>
        Promise.resolve({
          ok: false,
          code: "INVALID",
          message: "Invalid params.afterDays",
          fieldErrors: { afterDays: "Máximo 30 en este plan." },
        }),
    });
    type(strings.keyLabel, "Cierre");
    type(strings.afterDaysLabel, "60");
    save();
    expect(await screen.findByText("Máximo 30 en este plan.")).toBeInTheDocument();
    expect(errorOf(strings.afterDaysLabel)).toBe("Máximo 30 en este plan.");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("9. an invalid stored rule is an error row, and its editor marks the bad fields", () => {
    const invalid: RuleRowView = {
      id: "rule-1",
      key: "Horario viejo",
      type: "business_hours",
      params: {
        timezone: "Mars/Olympus",
        schedule: { mon: [["9", "18"]] },
        appliesTo: "sometimes",
      },
      accountId: "acc-gone",
      position: 0,
      active: true,
      origin: "code",
      valid: false,
      error: "timezone: Zona horaria IANA desconocida.\nschedule.mon.0.0: Usa HH:MM (00:00–24:00).",
      updatedBy: null,
      updatedByName: null,
      updatedAt: "2026-10-01T12:00:00.000Z",
    };
    const actions: RulesActions = {
      listRules: vi.fn(),
      saveRule: vi.fn(),
      toggleRule: vi.fn(),
      reorderRules: vi.fn(),
      deleteRule: vi.fn(),
    };
    render(<RulesScreen initialRules={[invalid]} numbers={NUMBERS} actions={actions} />);

    const list = screen.getByRole("list", { name: strings.listLabel });
    const row = within(list).getAllByRole("listitem")[0];
    if (row === undefined) throw new Error("no rule row");
    expect(within(row).getByText(/Regla inválida/)).toBeInTheDocument();
    expect(within(row).getByText(/Zona horaria IANA desconocida/)).toBeInTheDocument();
    expect(within(row).getByText(strings.originCode)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: strings.editLabel("Horario viejo") }));
    expect(screen.getByText(strings.invalidStoredNote)).toBeInTheDocument();
    expect(errorOf(strings.timezoneLabel)).toBe("Zona horaria IANA desconocida.");
    expect(screen.getByLabelText("Lunes, inicio del tramo 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText(strings.keyLabel)).toHaveAttribute("readonly");
  });
});
