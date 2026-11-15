//! Модуль интеграции с OBS Studio через протокол `obs-websocket` v5 (крейт `obws`).
//! Если OBS не запущен, мост не блокирует сервер и работает в автономном режиме.

use crate::state::AppState;
use obws::Client;
use std::sync::Arc;
use tokio::sync::Mutex;

struct ObsConnConfig {
    host: String,
    port: u16,
    password: Option<String>,
}

/// Асинхронный клиент-обёртка над `obws::Client`.
pub struct ObsBridge {
    config: Mutex<ObsConnConfig>,
    client: Mutex<Option<Client>>,
}

impl ObsBridge {
    /// Создаёт новый мост к OBS WebSocket.
    pub fn new(host: String, port: u16, password: Option<String>) -> Arc<Self> {
        Arc::new(Self {
            config: Mutex::new(ObsConnConfig {
                host,
                port,
                password: password.filter(|p| !p.trim().is_empty()),
            }),
            client: Mutex::new(None),
        })
    }

    /// Разбирает строку вида `127.0.0.1:4455` или `ws://127.0.0.1:4455`.
    fn parse_endpoint(raw: &str) -> (String, u16) {
        let stripped = raw
            .trim()
            .trim_start_matches("ws://")
            .trim_start_matches("wss://")
            .split('/')
            .next()
            .unwrap_or("127.0.0.1:4455");
        if let Some((h, p)) = stripped.rsplit_once(':') {
            if let Ok(port) = p.parse::<u16>() {
                return (h.to_string(), port);
            }
        }
        (stripped.to_string(), 4455)
    }

    /// Пытается подключиться к OBS Studio и синхронизировать список сцен.
    pub async fn try_connect(&self, state: &Arc<AppState>) -> bool {
        let (host, port, password) = {
            let cfg = self.config.lock().await;
            (cfg.host.clone(), cfg.port, cfg.password.clone())
        };

        match Client::connect(&host, port, password.as_deref()).await {
            Ok(client) => {
                let mut scenes_names = Vec::new();
                let mut current_scene = String::new();
                if let Ok(list) = client.scenes().list().await {
                    current_scene = list.current_program_scene.name.clone();
                    scenes_names = list.scenes.into_iter().map(|s| s.id.name).collect();
                }

                {
                    let mut guard = state.snapshot.write().await;
                    guard.obs.connected = true;
                    guard.obs.endpoint = format!("{}:{}", host, port);
                    guard.obs.password_set = password.is_some();
                    guard.obs.obs_version = Some("5.x".to_string());
                    guard.obs.last_error = None;
                    if !scenes_names.is_empty() {
                        guard.obs.scenes = scenes_names;
                    }
                    if !current_scene.is_empty() {
                        guard.obs.active_scene = current_scene;
                    }
                }

                *self.client.lock().await = Some(client);
                state
                    .push_log("info", "obs", format!("Подключено к OBS WebSocket ({}:{})", host, port))
                    .await;
                true
            }
            Err(err) => {
                let mut guard = state.snapshot.write().await;
                guard.obs.connected = false;
                guard.obs.endpoint = format!("{}:{}", host, port);
                guard.obs.password_set = password.is_some();
                guard.obs.last_error = Some(format!("OBS недоступен (автономный режим): {}", err));
                false
            }
        }
    }

    /// Обновляет адрес/пароль и переподключается к OBS WebSocket v5.
    pub async fn reconnect(
        &self,
        endpoint: &str,
        password: Option<String>,
        state: &Arc<AppState>,
    ) -> Result<(), String> {
        let (host, port) = Self::parse_endpoint(endpoint);
        {
            let mut cfg = self.config.lock().await;
            cfg.host = host;
            cfg.port = port;
            if let Some(pw) = password {
                cfg.password = if pw.trim().is_empty() { None } else { Some(pw) };
            }
        }
        *self.client.lock().await = None;
        if self.try_connect(state).await {
            Ok(())
        } else {
            let guard = state.snapshot.read().await;
            Err(guard
                .obs
                .last_error
                .clone()
                .unwrap_or_else(|| "Не удалось подключиться к OBS WebSocket".to_string()))
        }
    }

    /// Отключает активное соединение с OBS Studio.
    pub async fn disconnect(&self, state: &Arc<AppState>, reason: &str) {
        *self.client.lock().await = None;
        let mut guard = state.snapshot.write().await;
        guard.obs.connected = false;
        guard.obs.last_error = Some(reason.to_string());
    }

    /// Переключает сцену в OBS Studio (если подключён) и возвращает признак синхронизации с реальным OBS.
    pub async fn set_scene(&self, scene_name: &str, state: &Arc<AppState>) -> bool {
        let mut guard = self.client.lock().await;
        if let Some(client) = guard.as_ref() {
            match client.scenes().set_current_program_scene(scene_name).await {
                Ok(_) => return true,
                Err(err) => {
                    tracing::warn!("Сбой переключения сцены OBS '{}': {}", scene_name, err);
                    *guard = None;
                    drop(guard);
                    let mut st = state.snapshot.write().await;
                    st.obs.connected = false;
                    st.obs.last_error = Some(err.to_string());
                }
            }
        }
        false
    }

    /// Сохраняет буфер повтора (Replay Buffer) в OBS при создании маркера клипа.
    pub async fn save_replay_buffer(&self) -> bool {
        let guard = self.client.lock().await;
        if let Some(client) = guard.as_ref() {
            return client.replay_buffer().save().await.is_ok();
        }
        false
    }
}
