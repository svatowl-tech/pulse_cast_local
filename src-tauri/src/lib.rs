//! Нативный хост Tauri v2 для PulseCast Local.
//! Запускает встроенный Axum HTTP/WS-сервер, управляет системным треем,
//! независимыми pop-out окнами (Мультичат, OBS Dock, Микшер/Хоткеи, ИИ-Агент/Лента),
//! сохранением координат окон и глобальными системными горячими клавишами.

use pulsecast_local::{bind_server, ServerConfig};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub http_origin: String,
    pub ws_url: String,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GlobalShortcutItem {
    pub id: String,
    pub combo: String,
    pub enabled: bool,
}

pub struct DesktopState {
    pub server_info: ServerInfo,
    pub detached_windows: Arc<Mutex<HashSet<String>>>,
    pub active_shortcuts: Arc<Mutex<Vec<(Shortcut, String)>>>,
}

fn popout_spec(module_id: &str) -> Option<(&'static str, &'static str, &'static str, f64, f64, f64, f64)> {
    match module_id {
        "chat" => Some((
            "popout_chat",
            "PulseCast — Мультичат",
            "index.html?window=chat",
            390.0,
            720.0,
            300.0,
            380.0,
        )),
        "obs_dock" => Some((
            "popout_obs_dock",
            "PulseCast — OBS Dock",
            "index.html?window=obs_dock",
            360.0,
            760.0,
            280.0,
            420.0,
        )),
        "mixer" => Some((
            "popout_mixer",
            "PulseCast — Аудио-микшер и Хоткеи",
            "index.html?window=mixer",
            520.0,
            680.0,
            320.0,
            380.0,
        )),
        "agent_feed" => Some((
            "popout_agent_feed",
            "PulseCast — ИИ-Агент и Лента событий",
            "index.html?window=agent_feed",
            480.0,
            720.0,
            320.0,
            400.0,
        )),
        _ => None,
    }
}

fn emit_detached_list(app: &AppHandle, detached: &Arc<Mutex<HashSet<String>>>) {
    let mut list: Vec<String> = detached
        .lock()
        .map(|g| g.iter().cloned().collect())
        .unwrap_or_default();
    list.sort();
    let _ = app.emit("pulsecast://windows-changed", list);
}

fn show_main_window_internal(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn open_or_focus_popout_internal(
    app: &AppHandle,
    detached: &Arc<Mutex<HashSet<String>>>,
    module_id: &str,
) -> Result<(), String> {
    let Some((label, title, url, w, h, min_w, min_h)) = popout_spec(module_id) else {
        return Err(format!("Неизвестный модуль окна: {}", module_id));
    };

    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
    } else {
        WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(w, h)
            .min_inner_size(min_w, min_h)
            .resizable(true)
            .build()
            .map_err(|e| format!("Ошибка создания окна '{}': {}", label, e))?;
    }

    if let Ok(mut guard) = detached.lock() {
        guard.insert(module_id.to_string());
    }
    emit_detached_list(app, detached);
    Ok(())
}

#[tauri::command]
fn get_server_info(state: State<'_, DesktopState>) -> ServerInfo {
    state.server_info.clone()
}

#[tauri::command]
fn get_detached_windows(state: State<'_, DesktopState>) -> Vec<String> {
    let mut list: Vec<String> = state
        .detached_windows
        .lock()
        .map(|g| g.iter().cloned().collect())
        .unwrap_or_default();
    list.sort();
    list
}

#[tauri::command]
fn open_popout_window(
    app: AppHandle,
    state: State<'_, DesktopState>,
    module_id: String,
) -> Result<Vec<String>, String> {
    open_or_focus_popout_internal(&app, &state.detached_windows, &module_id)?;
    Ok(get_detached_windows(state))
}

#[tauri::command]
fn dock_popout_window(
    app: AppHandle,
    state: State<'_, DesktopState>,
    module_id: String,
    focus_main: Option<bool>,
) -> Result<Vec<String>, String> {
    if let Some((label, ..)) = popout_spec(&module_id) {
        if let Some(win) = app.get_webview_window(label) {
            let _ = app.save_window_state(StateFlags::all());
            let _ = win.close();
        }
    }
    if let Ok(mut guard) = state.detached_windows.lock() {
        guard.remove(&module_id);
    }
    emit_detached_list(&app, &state.detached_windows);
    if focus_main.unwrap_or(false) {
        show_main_window_internal(&app);
    }
    Ok(get_detached_windows(state))
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main_window_internal(&app);
}

#[tauri::command]
fn hide_main_to_tray(app: AppHandle) {
    let _ = app.save_window_state(StateFlags::all());
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    let _ = app.save_window_state(StateFlags::all());
    app.exit(0);
}

fn normalize_shortcut_combo(raw: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for token in raw.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let lower = token.to_ascii_lowercase();
        let mapped = match lower.as_str() {
            "ctrl" | "control" => "Control".to_string(),
            "cmdorctrl" | "commandorcontrol" => "CommandOrControl".to_string(),
            "alt" | "option" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "meta" | "super" | "cmd" | "win" => "Super".to_string(),
            " " | "space" | "spacebar" => "Space".to_string(),
            "esc" | "escape" => "Escape".to_string(),
            "del" | "delete" => "Delete".to_string(),
            "ins" | "insert" => "Insert".to_string(),
            "up" | "arrowup" => "ArrowUp".to_string(),
            "down" | "arrowdown" => "ArrowDown".to_string(),
            "left" | "arrowleft" => "ArrowLeft".to_string(),
            "right" | "arrowright" => "ArrowRight".to_string(),
            "enter" | "return" => "Enter".to_string(),
            _ if token.len() == 1 => {
                let ch = token.chars().next().unwrap();
                if ch.is_ascii_digit() {
                    format!("Digit{}", ch)
                } else if ch.is_ascii_alphabetic() {
                    format!("Key{}", ch.to_ascii_uppercase())
                } else {
                    token.to_string()
                }
            }
            _ => token.to_string(),
        };
        parts.push(mapped);
    }
    parts.join("+")
}

#[tauri::command]
fn sync_global_shortcuts(
    app: AppHandle,
    state: State<'_, DesktopState>,
    shortcuts: Vec<GlobalShortcutItem>,
) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();
    let mut registered = Vec::new();
    for item in shortcuts {
        if !item.enabled {
            continue;
        }
        let normalized = normalize_shortcut_combo(&item.combo);
        match normalized.parse::<Shortcut>() {
            Ok(sc) => {
                if let Err(err) = app.global_shortcut().register(sc.clone()) {
                    tracing::debug!("Не удалось зарегистрировать шорткат '{}': {}", normalized, err);
                } else {
                    registered.push((sc, item.id));
                }
            }
            Err(err) => {
                tracing::debug!("Некорректный формат шортката '{}' -> '{}': {:?}", item.combo, normalized, err);
            }
        }
    }
    if let Ok(mut guard) = state.active_shortcuts.lock() {
        *guard = registered;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pulsecast_local=info,pulsecast_desktop=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();

    let detached_windows = Arc::new(Mutex::new(HashSet::<String>::new()));
    let active_shortcuts = Arc::new(Mutex::new(Vec::<(Shortcut, String)>::new()));
    let shortcuts_for_handler = Arc::clone(&active_shortcuts);

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let matched_id = shortcuts_for_handler
                            .lock()
                            .ok()
                            .and_then(|list| {
                                list.iter()
                                    .find(|(sc, _)| sc == shortcut)
                                    .map(|(_, id)| id.clone())
                            });
                        if let Some(id) = matched_id {
                            let _ = app.emit("pulsecast://global-shortcut", id);
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Определяем кроссплатформенную папку данных ОС для профиля и загруженных ассетов
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
            let _ = std::fs::create_dir_all(&data_dir);

            let mut cfg = ServerConfig::from_env();
            cfg.profile_path = data_dir.join("pulsecast_profile.json");
            cfg.assets_dir = data_dir.join("assets");
            cfg.allow_ephemeral_fallback = true;

            let started = tauri::async_runtime::block_on(bind_server(cfg))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            let addr = started.local_addr;
            let server_info = ServerInfo {
                http_origin: format!("http://127.0.0.1:{}", addr.port()),
                ws_url: format!("ws://127.0.0.1:{}/ws", addr.port()),
                host: "127.0.0.1".to_string(),
                port: addr.port(),
            };

            app.manage(DesktopState {
                server_info,
                detached_windows: Arc::clone(&detached_windows),
                active_shortcuts: Arc::clone(&active_shortcuts),
            });

            tauri::async_runtime::spawn(async move {
                if let Err(err) = started.serve().await {
                    tracing::error!("Ошибка встроенного Axum-сервера: {}", err);
                }
            });

            // Системный трей: сворачивание без остановки сервера и вынесенных окон
            let show_item =
                MenuItem::with_id(app, "show", "Открыть главное окно студии", true, None::<&str>)?;
            let chat_item =
                MenuItem::with_id(app, "popout_chat", "Вынести / показать Мультичат", true, None::<&str>)?;
            let dock_item =
                MenuItem::with_id(app, "popout_obs_dock", "Вынести / показать OBS Dock", true, None::<&str>)?;
            let mixer_item =
                MenuItem::with_id(app, "popout_mixer", "Вынести / показать Микшер и Хоткеи", true, None::<&str>)?;
            let agent_item = MenuItem::with_id(
                app,
                "popout_agent_feed",
                "Вынести / показать ИИ-Агента и Ленту",
                true,
                None::<&str>,
            )?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Выход (остановить сервер)", true, None::<&str>)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&chat_item)
                .item(&dock_item)
                .item(&mixer_item)
                .item(&agent_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("PulseCast Local")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle, event| {
                    let id = event.id.as_ref();
                    match id {
                        "show" => show_main_window_internal(app_handle),
                        "quit" => {
                            let _ = app_handle.save_window_state(StateFlags::all());
                            app_handle.exit(0);
                        }
                        "popout_chat" | "popout_obs_dock" | "popout_mixer" | "popout_agent_feed" => {
                            let module_id = id.trim_start_matches("popout_");
                            let state = app_handle.state::<DesktopState>();
                            let _ = open_or_focus_popout_internal(
                                app_handle,
                                &state.detached_windows,
                                module_id,
                            );
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window_internal(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                WindowEvent::CloseRequested { api, .. } if label == "main" => {
                    let _ = window.app_handle().save_window_state(StateFlags::all());
                    let _ = window.hide();
                    api.prevent_close();
                }
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    if label.starts_with("popout_") =>
                {
                    let app = window.app_handle();
                    let _ = app.save_window_state(StateFlags::all());
                    let module_id = label.trim_start_matches("popout_").to_string();
                    let state = app.state::<DesktopState>();
                    if let Ok(mut guard) = state.detached_windows.lock() {
                        guard.remove(&module_id);
                    }
                    emit_detached_list(app, &state.detached_windows);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_server_info,
            get_detached_windows,
            open_popout_window,
            dock_popout_window,
            show_main_window,
            hide_main_to_tray,
            quit_app,
            sync_global_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("Критическая ошибка запуска Tauri-приложения PulseCast Local");
}
