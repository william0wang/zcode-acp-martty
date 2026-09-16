//! Zcode bridge (zcode-acp-server) ACP extension notifications.
//!
//! The bridge broadcasts these untyped notifications to every attached
//! client; ACP clients that don't know the methods ignore them, so no
//! capability negotiation is needed. Older martty builds ignore them the
//! same way — the whitelist simply doesn't match.

/// Per-session turn liveness for turns driven by ANY attached client (phone,
/// editor, another window): `{"sessionId": string, "running": bool}`. Folding
/// it into the local running bit is what makes submits queue behind a
/// phone-driven turn instead of silently preempting it.
pub const TURN_STATE: &str = "$/zcode/turnState";

/// A session was retired from the bridge by a remote close: `{"sessionId":
/// string}`. The window showing that session quits cleanly (the incubated
/// terminal closes with it); a background tab just loses its tab.
pub const SESSION_CLOSED: &str = "$/zcode/session_closed";

/// An interaction ask (permission / elicitation) was DECIDED on another
/// client (or the bridge's wait broke): `{"sessionId": string, "kind":
/// "permission"|"elicitation", "toolCallId"?: string}`. This client's copy of
/// the dialog must dismiss — the ACP SDK never sends `$/cancel_request` to
/// the losing client, so without this the popup hangs forever.
pub const ASK_SETTLED: &str = "$/zcode/ask_settled";
