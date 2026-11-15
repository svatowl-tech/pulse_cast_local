//! Библиотечное ядро PulseCast Local.
//! Используется как автономным headless-сервером (`pulsecast-local`),
//! так и нативным десктопным приложением на Tauri v2 (`pulsecast-desktop`).

pub mod agent;
pub mod bot;
pub mod bridges;
pub mod obs;
pub mod plugins;
pub mod server;
pub mod state;
pub mod whisper_sub;

pub use server::{bind_server, ServerConfig, StartedServer};
