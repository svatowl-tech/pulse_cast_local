//! Автономная headless-точка входа PulseCast Local (сервер без GUI).
//! Запускает Axum HTTP/WebSocket-сервер (`127.0.0.1:8080` по умолчанию),
//! раздаёт статические интерфейсы дашборда и OBS-оверлея (`/overlay`).

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pulsecast_local=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();

    let cfg = pulsecast_local::ServerConfig::from_env();
    let started = pulsecast_local::bind_server(cfg)
        .await
        .expect("Не удалось запустить сервер PulseCast Local");
    started
        .serve()
        .await
        .expect("Критическая ошибка HTTP-сервера Axum");
}
