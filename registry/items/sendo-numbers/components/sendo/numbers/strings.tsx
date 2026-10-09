"use client";

import type { Channel, OnboardedVia } from "@quami/sendo";
import { createContext, useContext } from "react";

/** Every user-visible string of the numbers screen. Override any of them through `<NumbersScreen strings>`. */
export interface NumbersStrings {
  // Layout
  navLabel: string;
  navInbox: string;
  navNumbers: string;
  backToInbox: string;
  title: string;
  subtitle: string;
  count: (count: number) => string;
  // Access
  readOnlyNotice: string;
  hidden: string;
  forbidden: string;
  loadFailed: string;
  // Empty state
  emptyTitle: string;
  emptyDescription: string;
  emptyReadOnly: string;
  // Connect (Embedded Signup)
  connectFirst: string;
  connectAnother: string;
  connecting: string;
  connectPreparing: string;
  connectNotConfigured: string;
  connectChooseTitle: string;
  connectChooseDescription: string;
  connectCloudTitle: string;
  connectCloudDescription: string;
  connectCoexistenceTitle: string;
  connectCoexistenceDescription: string;
  connected: (phone: string) => string;
  reconnect: string;
  reconnected: (phone: string) => string;
  signupCancelled: string;
  signupMetaError: string;
  signupNoNumber: string;
  signupCodeExpired: string;
  signupPermissionMissing: string;
  signupPermissionDocs: string;
  signupAccountExists: string;
  signupAlreadyConnected: string;
  signupWrongNumber: (phone: string) => string;
  signupFailed: string;
  signupConfigError: string;
  sdkLoadFailed: string;
  // PIN (two-step verification)
  pinTitle: string;
  pinDescription: string;
  pinLabel: string;
  pinInvalid: string;
  pinSubmit: string;
  cancel: string;
  // Status
  statusConnected: string;
  statusBillingMissing: string;
  statusBillingUnknown: string;
  statusTokenInvalid: string;
  statusDisconnected: string;
  billingAdd: string;
  billingVerify: string;
  billingVerifyUnknown: string;
  billingVerifying: string;
  billingConfirmed: string;
  billingStillMissing: string;
  billingStillUnknown: string;
  tokenInvalidHint: string;
  disconnectedHint: string;
  // Row
  badgeDefault: string;
  badgeCoexistence: string;
  channelLabel: (channel: Channel) => string;
  onboardedVia: (via: OnboardedVia) => string;
  // Label
  labelEdit: string;
  labelInput: string;
  labelPlaceholder: string;
  labelSave: string;
  labelCancel: string;
  // Agent
  agentPause: string;
  agentPausedOn: (phone: string) => string;
  agentResumedOn: (phone: string) => string;
  agentStatusPaused: string;
  agentStatusActive: string;
  agentMode: string;
  agentModeInherit: string;
  agentModeAuto: string;
  agentModeDraft: string;
  // Default
  setDefault: string;
  defaultSet: (phone: string) => string;
  // Disconnect
  disconnect: string;
  disconnectTitle: (phone: string) => string;
  disconnectDescription: string;
  disconnectConfirmLabel: (digits: string) => string;
  disconnectConfirm: string;
  disconnecting: string;
  disconnected: (phone: string) => string;
  disconnectMismatch: string;
  // Errors
  actionFailed: string;
  noPermission: string;
}

const ONBOARDED_VIA_LABELS: Record<OnboardedVia, string> = {
  manual: "Alta manual",
  embedded_signup: "Conectado con Meta",
  connect: "Sendo Connect",
};

export const defaultNumbersStrings: NumbersStrings = {
  navLabel: "Secciones",
  navInbox: "Bandeja",
  navNumbers: "Números",
  backToInbox: "Bandeja",
  title: "Números",
  subtitle: "Los números de WhatsApp de tu organización.",
  count: (count) => (count === 1 ? "1 número" : `${String(count)} números`),
  readOnlyNotice: "Solo los administradores pueden cambiar los números.",
  hidden: "Solo los administradores pueden ver los números.",
  forbidden: "No tienes acceso a los números.",
  loadFailed: "No se pudieron cargar los números.",
  emptyTitle: "Todavía no hay números conectados",
  emptyDescription:
    "Conecta el WhatsApp de tu organización. Meta abre una ventana para elegir la cuenta y el número; no necesitas salir de la app.",
  emptyReadOnly: "Pide a un administrador que conecte el número de WhatsApp.",
  connectFirst: "Conectar WhatsApp",
  connectAnother: "Conectar otro",
  connecting: "Conectando…",
  connectPreparing: "Preparando Meta…",
  connectNotConfigured:
    "Para conectar números configura NEXT_PUBLIC_SENDO_META_APP_ID y NEXT_PUBLIC_SENDO_META_CONFIG_ID.",
  connectChooseTitle: "Conectar un número de WhatsApp",
  connectChooseDescription:
    "Meta abrirá una ventana para elegir la cuenta de WhatsApp Business y el número.",
  connectCloudTitle: "Un número nuevo",
  connectCloudDescription: "Un número que no usas en la app WhatsApp Business del teléfono.",
  connectCoexistenceTitle: "El número que ya usas en el teléfono",
  connectCoexistenceDescription:
    "Sigues respondiendo desde la app WhatsApp Business y tu equipo, desde aquí.",
  connected: (phone) => `${phone} conectado`,
  reconnect: "Reconectar",
  reconnected: (phone) => `${phone} reconectado`,
  signupCancelled: "Conexión cancelada. No se creó nada.",
  signupMetaError: "Meta no pudo completar la conexión. Intenta de nuevo.",
  signupNoNumber: "Meta no devolvió un número. Vuelve a intentarlo y elige un número.",
  signupCodeExpired: "El enlace con Meta expiró, intenta de nuevo.",
  signupPermissionMissing:
    "Tu app de Meta todavía no tiene los permisos para conectar números (revisión de la app).",
  signupPermissionDocs: "Ver requisitos",
  signupAccountExists: "Este número ya está conectado en otra organización",
  signupAlreadyConnected: "Este número ya está conectado.",
  signupWrongNumber: (phone) => `Elegiste otro número en Meta. Para reconectar, elige ${phone}.`,
  signupFailed: "No se pudo conectar el número. Intenta de nuevo.",
  signupConfigError: "Falta configurar Embedded Signup en el servidor.",
  sdkLoadFailed: "No se pudo cargar Meta. Revisa la conexión o el bloqueador de anuncios.",
  pinTitle: "Este número tiene verificación en dos pasos",
  pinDescription:
    "Escribe el PIN de 6 dígitos del número. Meta abrirá la ventana otra vez para terminar.",
  pinLabel: "PIN de 6 dígitos",
  pinInvalid: "El PIN tiene 6 dígitos.",
  pinSubmit: "Conectar con el PIN",
  cancel: "Cancelar",
  statusConnected: "Conectado",
  statusBillingMissing: "Conectado · falta método de pago",
  statusBillingUnknown: "Conectado · estado de pago desconocido",
  statusTokenInvalid: "Token inválido · reconectar",
  statusDisconnected: "Desconectado",
  billingAdd: "Agregar en Meta",
  billingVerify: "Ya lo agregué, verificar",
  billingVerifyUnknown: "Verificar",
  billingVerifying: "Verificando…",
  billingConfirmed: "Método de pago confirmado.",
  billingStillMissing: "Meta todavía no muestra un método de pago.",
  billingStillUnknown: "Meta no dijo si hay método de pago. El primer envío lo confirma.",
  tokenInvalidHint: "Meta rechazó el acceso. Conéctalo otra vez; el historial se conserva.",
  disconnectedHint: "Las conversaciones siguen visibles, sin respuestas.",
  badgeDefault: "Por defecto",
  badgeCoexistence: "También en la app del teléfono",
  channelLabel: () => "WhatsApp",
  onboardedVia: (via) => ONBOARDED_VIA_LABELS[via],
  labelEdit: "Editar etiqueta",
  labelInput: "Etiqueta",
  labelPlaceholder: "Ej. Cobranza",
  labelSave: "Guardar",
  labelCancel: "Cancelar",
  agentPause: "Pausar agente",
  agentPausedOn: (phone) => `Agente pausado en ${phone}`,
  agentResumedOn: (phone) => `Agente activo en ${phone}`,
  agentStatusPaused: "Agente pausado",
  agentStatusActive: "Agente activo",
  agentMode: "Modo del agente",
  agentModeInherit: "Según el agente",
  agentModeAuto: "Responde solo",
  agentModeDraft: "Propone borradores",
  setDefault: "Marcar por defecto",
  defaultSet: (phone) => `${phone} es el número por defecto`,
  disconnect: "Desconectar",
  disconnectTitle: (phone) => `Desconectar ${phone}`,
  disconnectDescription:
    "Las conversaciones anteriores siguen visibles, pero ya no se podrá responder desde este número y el agente deja de contestar. Puedes volver a conectarlo después.",
  disconnectConfirmLabel: (digits) => `Escribe ${digits}, los últimos 4 dígitos, para confirmar`,
  disconnectConfirm: "Desconectar número",
  disconnecting: "Desconectando…",
  disconnected: (phone) => `${phone} desconectado`,
  disconnectMismatch: "Los dígitos no coinciden.",
  actionFailed: "No se pudo actualizar el número.",
  noPermission: "No tienes permiso para cambiar los números.",
};

export function mergeNumbersStrings(overrides?: Partial<NumbersStrings>): NumbersStrings {
  return overrides === undefined
    ? defaultNumbersStrings
    : { ...defaultNumbersStrings, ...overrides };
}

export const NumbersStringsContext = createContext<NumbersStrings>(defaultNumbersStrings);

export function useNumbersStrings(): NumbersStrings {
  return useContext(NumbersStringsContext);
}
