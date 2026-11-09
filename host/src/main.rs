// bridge-gtk-host · main entry point.
//
// Spawned by `@nandomo/bridge-gtk` via `child_process.spawn`. Reads JSON
// commands on stdin (line-delimited), builds GTK widgets imperatively,
// runs the GTK main loop, and forwards GTK signal events back as JSON
// on stdout.
//
// Architecture: the stdin reader posts commands to an asynchronous channel.
// A local GLib task sleeps until commands arrive, preserving GTK thread affinity.
// Large bursts yield periodically so input and drawing can continue.

use std::cell::{Cell, RefCell};
use std::io::{self, BufRead, Write};
use std::rc::Rc;
use futures_channel::mpsc::{self, UnboundedSender};
use futures_util::StreamExt;
use std::thread;

use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{Application, ApplicationWindow, Widget};

mod commands;
mod pagination;
mod controls;
mod checkbox;
mod appearance;
mod accessibility;
mod layout;

use commands::{dispatch, Command, Event, LogLevel, WidgetRegistry};

const APP_ID: &str = "org.nandomo.bridge_gtk_host";
const READ_BUFFER_BYTES: usize = 64 * 1024;

/// Emit one event to stdout (line-delimited JSON).
fn emit_event(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        // Lock stdout for the whole write — the writer thread could
        // interleave bytes otherwise. Mutex-free because writes are
        // short and the OS-level pipe write is atomic for sizes
        // below PIPE_BUF (4096 on Linux).
        let stdout = io::stdout();
        let mut out = stdout.lock();
        let _ = writeln!(out, "{}", json);
        let _ = out.flush();
    }
}

fn log(level: LogLevel, msg: impl Into<String>) {
    emit_event(&Event::Log {
        level,
        message: msg.into(),
    });
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The smoke test can opt-in to a verbose logging mode by setting
    // BRIDGE_GTK_VERBOSE=1 — useful for diagnosing wiring issues.
    let verbose = std::env::var_os("BRIDGE_GTK_VERBOSE").is_some();

    let app = Application::builder()
        .application_id(APP_ID)
        // Don't auto-register with DBus — we're a child process
        // and the parent JS host owns lifecycle.
        .flags(gtk4::gio::ApplicationFlags::NON_UNIQUE)
        .build();

    // Ownership of the only sender passes to the reader: EOF closes the channel.
    let (tx, mut rx) = mpsc::unbounded::<Command>();

    // Spawn the stdin reader thread BEFORE running the main loop.
    // The thread blocks on stdin reads; main thread blocks on
    // app.run(). They meet at the asynchronous channel.
    thread::Builder::new()
        .name("bridge-gtk-stdin".to_string())
        .spawn(move || {
            stdin_reader(tx);
        })?;

    // The widget registry owns every widget id we allocate.
    let reg = std::sync::Arc::new(std::sync::Mutex::new(WidgetRegistry::new()));

    // The event emitter is shared with the window-size listener below, so
    // it has to exist before `connect_activate` runs.
    let emit: Rc<RefCell<dyn FnMut(Event)>> = Rc::new(RefCell::new(|ev: Event| {
        emit_event(&ev);
    }));

    // Wire the application instance into the registry so the
    // `Window` create handler can build an ApplicationWindow against
    // it.
    {
        let mut r = reg.lock().unwrap();
        r.app = Some(app.clone());
    }

    // When the app activates, create id=1 (the ApplicationWindow) and
// present it. The JS side relies on id 1 existing as the root
// container — every other widget reparents under it.
    let app_handle = app.clone();
    let reg_for_activate = reg.clone();
    let emit_for_activate = emit.clone();
    app.connect_activate(move |a| {
        if verbose {
            log(LogLevel::Info, "activate fired");
        }
        let mut r = reg_for_activate.lock().unwrap();
        if r.window.is_none() {
            // Create the implicit root window at id 1. This matches
            // the JS-side convention: the JS bridge allocates ids
            // starting at 2 because it assumes id 1 is the root.
            if let Some(app) = r.app.as_ref() {
                let window = ApplicationWindow::builder()
                    .application(app)
                    .title("nandomo bridge-gtk")
                    .default_width(320)
                    .default_height(240)
                    .build();
                let widget: Widget = window.clone().upcast();
                // Drag and drop: accept dropping .epub / .pdf files directly onto the window
                let drop_target = gtk4::DropTarget::new(gtk4::gio::File::static_type(), gtk4::gdk::DragAction::COPY);
                let emit_drop = emit_for_activate.clone();
                drop_target.connect_drop(move |_, val, _, _| {
                    if let Ok(file) = val.get::<gtk4::gio::File>() {
                        if let Some(path) = file.path() {
                            if let Some(path_str) = path.to_str() {
                                emit_drop.borrow_mut()(Event::Change {
                                    handler: None,
                                    id: 1,
                                    signal: "file-drop".into(),
                                    value: serde_json::Value::String(path_str.to_string()),
                                });
                                return true;
                            }
                        }
                    }
                    false
                });
                window.add_controller(drop_target);

                // Keyboard navigation: forward arrow keys to JS for page navigation.
                // Capture phase so the app sees the key before the focused widget —
                // otherwise a focused Button would swallow it (and Space would
                // activate "Escolher livro" and pop the file picker open).
                let key_controller = gtk4::EventControllerKey::new();
                key_controller.set_propagation_phase(gtk4::PropagationPhase::Capture);
                let emit_key = emit_for_activate.clone();
                key_controller.connect_key_pressed(move |_, key, _, _| {
                    let key_name = match key {
                        gtk4::gdk::Key::Right | gtk4::gdk::Key::Page_Down => Some("next"),
                        gtk4::gdk::Key::Left | gtk4::gdk::Key::Page_Up => Some("previous"),
                        _ => None,
                    };
                    if let Some(action) = key_name {
                        emit_key.borrow_mut()(Event::Change {
                            handler: None,
                            id: 1,
                            signal: "key-pressed".into(),
                            value: serde_json::Value::String(action.to_string()),
                        });
                        glib::Propagation::Stop
                    } else {
                        glib::Propagation::Proceed
                    }
                });
                window.add_controller(key_controller);

                // Report the window size so apps can lay out pages for the real space.
                let emit_size = emit_for_activate.clone();
                window.connect_realize(move |w| {
                    let Some(surface) = w.surface() else { return };
                    let emit = emit_size.clone();
                    let last = Cell::new((0, 0));
                    surface.connect_layout(move |_, width, height| {
                        if last.replace((width, height)) == (width, height) { return; }
                        emit.borrow_mut()(Event::Change {
                            handler: None,
                            id: 1,
                            signal: "window-size".into(),
                            value: serde_json::json!({ "width": width, "height": height }),
                        });
                    });
                });

                r.widgets.insert(1, widget);
                r.kinds.insert(1, "Window".to_string());
                r.window = Some(window);
            }
        }
        if let Some(win) = r.window.as_ref() {
            win.present();
        }
        drop(r);



        // Tell JS we're ready. We send `ready` here (after activate)
        // so any JS commands arriving on stdin have a fully
        // initialized GTK context to dispatch into.
        emit_for_activate.borrow_mut()(Event::Ready);
        let _ = a;
        let _ = app_handle; // keep the reference alive
    });

    let reg_for_commands = reg.clone();
    let app_for_commands = app.clone();
    glib::MainContext::default().spawn_local(async move {
        let mut count = 0;
        while let Some(cmd) = rx.next().await {
            if verbose { log(LogLevel::Info, format!("dispatch: {:?}", cmd)); }
            {
                let mut registry = reg_for_commands.lock().unwrap();
                if let Err(error) = dispatch(cmd, &mut registry, emit.clone()) {
                    log(LogLevel::Error, format!("dispatch error: {}", error));
                }
                if let Some(window) = registry.window.as_ref() {
                    if !window.is_visible() { window.present(); }
                }
            }
            count += 1;
            if count >= 64 {
                count = 0;
                glib::timeout_future(std::time::Duration::from_millis(1)).await;
            }
        }
        log(LogLevel::Info, "stdin disconnected, quitting");
        app_for_commands.quit();
    });

    // The app.run() blocks until app.quit() is called. We quit
    // when stdin is closed or when the user calls destroy on the
    // root window.
    //
    // Empty argv — `flags: NON_UNIQUE` told GTK we don't care about
    // parsing platform argv.
    let rc: i32 = app.run_with_args::<&str>(&[]).into();

    emit_event(&Event::Exit { code: rc });
    Ok(())
}

/// Reads stdin line-by-line and pushes parsed Commands into the
/// channel. Returns when stdin EOFs or errors.
fn stdin_reader(tx: UnboundedSender<Command>) {
    let stdin = io::stdin();
    let mut buf = String::with_capacity(READ_BUFFER_BYTES);
    let mut reader = stdin.lock();
    loop {
        buf.clear();
        let n = match reader.read_line(&mut buf) {
            Ok(n) => n,
            Err(err) => {
                log(LogLevel::Warn, format!("stdin read error: {}", err));
                break;
            }
        };
        if n == 0 {
            // EOF — JS parent closed stdin.
            log(LogLevel::Info, "stdin EOF, reader exiting");
            break;
        }
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<Command>(line) {
            Ok(cmd) => {
                if tx.unbounded_send(cmd).is_err() {
                    // Main thread dropped its receiver — exit.
                    break;
                }
            }
            Err(err) => {
                log(
                    LogLevel::Error,
                    format!("failed to parse command line: {} | line={}", err, line),
                );
            }
        }
    }
}
