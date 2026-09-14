//! `dismiss_ask_by_request_id`: when the agent cancels a pending permission
//! or elicitation request (answered elsewhere in a multi-client setup), the
//! stale overlay must drop from the live view AND from parked session slots.

use super::*;
use std::sync::mpsc::Receiver;

fn test_app() -> (App, Controller, Receiver<AppEvent>) {
    let cfg = RuntimeConfig {
        bin: "demo".into(),
        cordis: "demo".into(),
        workspace: "/tmp".into(),
        session_root: std::env::temp_dir()
            .join(format!("dsh-tui-ask-cancel-{}", std::process::id()))
            .to_string_lossy()
            .into_owned(),
        provider: "deepseek-official".into(),
        model: "deepseek-v4-flash".into(),
        max_tokens: None,
        base_url: None,
        api_key: None,
    };
    let (tx, rx) = std::sync::mpsc::channel::<AppEvent>();
    let ctl = Controller::start(cfg.clone(), true, None, tx.clone());
    let app = App::new(Some(Theme::dark()), cfg, "dsh-test".into(), true, false, tx);
    (app, ctl, rx)
}

fn ask_options() -> Vec<PermissionAskOption> {
    vec![PermissionAskOption {
        option_id: "allow_once".into(),
        kind: "allow_once".into(),
        name: "Allow once".into(),
    }]
}

fn ask_options_event(
    request_id: RequestId,
    reply: tokio::sync::oneshot::Sender<PermissionAskReply>,
) -> AppEvent {
    AppEvent::PermissionAsk {
        session_id: "dsh-test".into(),
        request_id,
        title: "Run tool".into(),
        options: ask_options(),
        reply,
    }
}

#[test]
fn ask_cancel_dismisses_live_permission_ask_and_replies_cancelled() {
    let (mut app, _ctl, _rx) = test_app();
    let (tx, mut reply_rx) = tokio::sync::oneshot::channel();
    let event = ask_options_event(RequestId::Number(7), tx);
    app.handle(event, &_ctl);
    assert!(app.permission_ask.is_some(), "ask should be on screen");

    let dismissed = app.dismiss_ask_by_request_id(&RequestId::Number(7));
    assert!(dismissed);
    assert!(app.permission_ask.is_none(), "stale ask must be dropped");
    // The Drop impl settles the responder side even if the watcher task is gone.
    assert_eq!(
        reply_rx.try_recv().ok(),
        Some(PermissionAskReply::Cancelled)
    );
}

#[test]
fn ask_cancel_dismisses_ask_parked_with_its_session() {
    let (mut app, _ctl, _rx) = test_app();
    app.parked.push(SessionSlot::fresh("parked-1".into(), true));
    let (tx, _reply_rx) = tokio::sync::oneshot::channel();
    // An ask for an out-of-view session parks on that session's tab.
    let event = AppEvent::PermissionAsk {
        session_id: "parked-1".into(),
        request_id: RequestId::Number(9),
        title: "Run tool".into(),
        options: ask_options(),
        reply: tx,
    };
    app.handle(event, &_ctl);
    assert!(app.permission_ask.is_none(), "must not float over the live tab");
    assert!(
        app.parked[0].permission_ask.is_some(),
        "ask should wait on its own tab"
    );

    assert!(app.dismiss_ask_by_request_id(&RequestId::Number(9)));
    assert!(app.parked[0].permission_ask.is_none());
}

#[test]
fn ask_cancel_dismisses_live_elicitation_ask() {
    let (mut app, _ctl, _rx) = test_app();
    let form = crate::elicitation::ElicitationForm {
        message: "Plan review".into(),
        fields: Vec::new(),
    };
    let (tx, _reply_rx) = tokio::sync::oneshot::channel();
    let event = AppEvent::ElicitationAsk {
        session_id: None,
        request_id: RequestId::Str("e-1".into()),
        form,
        reply: tx,
    };
    app.handle(event, &_ctl);
    assert!(app.elicitation_ask.is_some());

    assert!(app.dismiss_ask_by_request_id(&RequestId::Str("e-1".into())));
    assert!(app.elicitation_ask.is_none());
}

#[test]
fn ask_cancel_ignores_unknown_request_ids() {
    let (mut app, _ctl, _rx) = test_app();
    let (tx, _reply_rx) = tokio::sync::oneshot::channel();
    let event = ask_options_event(RequestId::Number(7), tx);
    app.handle(event, &_ctl);

    assert!(!app.dismiss_ask_by_request_id(&RequestId::Number(8)));
    assert!(app.permission_ask.is_some(), "unrelated cancel must not dismiss");
    assert!(app.dismiss_ask_by_request_id(&RequestId::Number(7)));
    assert!(!app.dismiss_ask_by_request_id(&RequestId::Number(7)), "double cancel is a no-op");
}
