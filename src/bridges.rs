//! Модуль универсального захвата уведомлений со сторонних сцен (DonationAlerts, Boosty,
//! DonatePay, StreamElements и др.), дедупликации OCR/DOM-событий, подбора вариаций алертов
//! и локального хранения медиа-ассетов (картинки, GIF, аудио).

use crate::state::{AlertVariation, BridgeParserRule, MediaAsset, StreamEvent, StreamEventKind};
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

/// Окно дедупликации (в секундах), чтобы OCR или MutationObserver не дублировали один алерт.
const DEDUP_WINDOW_SECS: i64 = 12;

/// Хранилище недавних хэшей распознанных уведомлений для защиты от дублей.
pub struct BridgeDeduplicator {
    seen: Mutex<HashMap<String, DateTime<Utc>>>,
}

impl BridgeDeduplicator {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            seen: Mutex::new(HashMap::new()),
        })
    }

    /// Проверяет, встречалась ли эта строка/событие в последние 12 секунд.
    /// Возвращает `true`, если событие уникально и его можно пропустить дальше.
    pub async fn check_and_record(&self, key: &str) -> bool {
        let now = Utc::now();
        let norm = key.trim().to_lowercase();
        if norm.is_empty() {
            return false;
        }
        let mut guard = self.seen.lock().await;
        guard.retain(|_, ts| now - *ts < Duration::seconds(DEDUP_WINDOW_SECS));
        if guard.contains_key(&norm) {
            return false;
        }
        guard.insert(norm, now);
        true
    }
}

/// Разбирает сырой текст уведомления от внешней сцены с помощью списка `BridgeParserRule`.
pub fn parse_raw_alert(
    raw_text: &str,
    source_hint: Option<&str>,
    rules: &[BridgeParserRule],
) -> Option<StreamEvent> {
    let cleaned = raw_text.replace('\n', " ").replace('\r', " ");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut sorted_rules: Vec<&BridgeParserRule> = rules.iter().filter(|r| r.enabled).collect();
    sorted_rules.sort_by(|a, b| b.priority.cmp(&a.priority));

    for rule in sorted_rules {
        if let Some(hint) = source_hint {
            if !hint.is_empty()
                && !rule.platform.eq_ignore_ascii_case("custom")
                && !rule.platform.eq_ignore_ascii_case(hint)
                && !hint.eq_ignore_ascii_case("auto")
            {
                continue;
            }
        }
        if let Ok(re) = Regex::new(&rule.pattern) {
            if let Some(caps) = re.captures(trimmed) {
                let user = caps
                    .name("user")
                    .map(|m| m.as_str().trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "Аноним".to_string());
                let amount: f64 = caps
                    .name("amount")
                    .and_then(|m| m.as_str().replace(',', ".").replace(' ', "").parse().ok())
                    .unwrap_or(100.0);
                let currency = caps
                    .name("currency")
                    .map(|m| m.as_str().trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "₽".to_string());
                let message = caps
                    .name("message")
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();

                return Some(StreamEvent {
                    id: Uuid::new_v4(),
                    kind: rule.default_kind.clone(),
                    source: format!("{}-Bridge", rule.platform),
                    username: user,
                    amount: amount.max(0.0),
                    currency,
                    original_amount: None,
                    original_currency: None,
                    message,
                    sound_id: Some("fanfare".to_string()),
                    tts_enabled: true,
                    variation_id: None,
                    media_url: None,
                    media_title: None,
                    media_duration_sec: None,
                    created_at: Utc::now(),
                });
            }
        }
    }

    None
}

/// Подбирает наиболее подходящую вариацию алерта по условиям суммы, площадки, типа и слова.
pub fn match_alert_variation(event: &StreamEvent, variations: &[AlertVariation]) -> Option<AlertVariation> {
    let mut enabled: Vec<&AlertVariation> = variations.iter().filter(|v| v.enabled).collect();
    enabled.sort_by(|a, b| b.priority.cmp(&a.priority));

    let source_low = event.source.to_lowercase();
    let msg_low = event.message.to_lowercase();

    for v in enabled {
        if let Some(kind) = &v.event_kind {
            if kind != &event.kind {
                continue;
            }
        }
        if !v.source_filter.trim().is_empty() && !source_low.contains(&v.source_filter.to_lowercase()) {
            continue;
        }
        if event.amount < v.min_amount {
            continue;
        }
        if let Some(max_a) = v.max_amount {
            if event.amount > max_a {
                continue;
            }
        }
        if !v.keyword.trim().is_empty() && !msg_low.contains(&v.keyword.to_lowercase()) {
            continue;
        }
        return Some(v.clone());
    }
    None
}

/// Сохраняет загруженный пользователем медиа-ассет (картинка/GIF/звук) на диск в `assets/`.
pub fn save_media_asset_bytes(
    assets_dir: &Path,
    original_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<MediaAsset, String> {
    std::fs::create_dir_all(assets_dir).map_err(|e| format!("Не удалось создать папку assets: {}", e))?;

    let safe_name: String = original_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let id = Uuid::new_v4().to_string();
    let stored_name = format!("{}_{}", &id[..8], if safe_name.is_empty() { "asset.bin" } else { &safe_name });
    let target_path = assets_dir.join(&stored_name);

    std::fs::write(&target_path, bytes).map_err(|e| format!("Ошибка записи ассета: {}", e))?;

    let kind = if mime_type.starts_with("audio/") {
        "audio".to_string()
    } else {
        "image".to_string()
    };

    Ok(MediaAsset {
        id,
        name: original_name.to_string(),
        kind,
        mime_type: mime_type.to_string(),
        url: format!("/assets/{}", stored_name),
        created_at: Utc::now(),
    })
}

/// Возвращает стартовые правила парсинга уведомлений для популярных платформ.
pub fn default_parser_rules() -> Vec<BridgeParserRule> {
    vec![
        BridgeParserRule {
            id: "rule_da".to_string(),
            name: "DonationAlerts (стандартный текст)".to_string(),
            platform: "DonationAlerts".to_string(),
            enabled: true,
            priority: 100,
            default_kind: StreamEventKind::Donation,
            pattern: r"(?i)(?P<user>[^\s\-–:]+)\s*(?:отправил|задонатил|пожертвовал|sent|donated)\s*(?P<amount>\d+(?:[.,]\d+)?)\s*(?P<currency>₽|RUB|USD|\$|EUR|€|UAH|KZT)?(?:\s*[-–:]\s*(?P<message>.+))?".to_string(),
        },
        BridgeParserRule {
            id: "rule_boosty".to_string(),
            name: "Boosty (подписка или донат)".to_string(),
            platform: "Boosty".to_string(),
            enabled: true,
            priority: 95,
            default_kind: StreamEventKind::Donation,
            pattern: r"(?i)(?:boosty[:\s]*)?(?P<user>[^\s\-–:]+)\s*(?:поддержал|подписался|купил уровень|donated)\s*(?:на\s*)?(?P<amount>\d+(?:[.,]\d+)?)?\s*(?P<currency>₽|RUB|USD|\$)?(?:\s*[-–:]\s*(?P<message>.+))?".to_string(),
        },
        BridgeParserRule {
            id: "rule_se".to_string(),
            name: "StreamElements / Streamlabs".to_string(),
            platform: "StreamElements".to_string(),
            enabled: true,
            priority: 90,
            default_kind: StreamEventKind::Donation,
            pattern: r"(?i)(?P<user>[^\s]+)\s*(?:tipped|donated|cheered)\s*(?P<currency>\$|€|₽)?(?P<amount>\d+(?:[.,]\d+)?)(?:\s*[-–:]\s*(?P<message>.+))?".to_string(),
        },
        BridgeParserRule {
            id: "rule_generic".to_string(),
            name: "Универсальный парсер: Имя + Сумма".to_string(),
            platform: "Custom".to_string(),
            enabled: true,
            priority: 10,
            default_kind: StreamEventKind::Donation,
            pattern: r"(?P<user>[\p{L}\p{N}_.-]+)\s+(?P<amount>\d+(?:[.,]\d+)?)\s*(?P<currency>₽|RUB|USD|\$|EUR|€)?(?:\s*[:\-–]\s*(?P<message>.+))?".to_string(),
        },
    ]
}

/// Возвращает стартовые условные вариации алертов.
pub fn default_alert_variations() -> Vec<AlertVariation> {
    vec![
        AlertVariation {
            id: "var_vip_big".to_string(),
            name: "Крупный донат (от 500 ₽)".to_string(),
            enabled: true,
            priority: 100,
            source_filter: "".to_string(),
            event_kind: Some(StreamEventKind::Donation),
            min_amount: 500.0,
            max_amount: None,
            keyword: "".to_string(),
            image_url: "".to_string(),
            sound_url: "".to_string(),
            sound_id: "fanfare".to_string(),
            title_template: "КОРОЛЕВСКИЙ ДОНАТ · {user} ({amount} {currency})".to_string(),
            tts_template: "{user} занёс {amount} {currency}! {message}".to_string(),
            duration_ms: 6000,
            animation: "zoom".to_string(),
            bg_color: "rgba(17, 24, 39, 0.94)".to_string(),
            accent_color: "#F59E0B".to_string(),
            text_color: "#FEF3C7".to_string(),
        },
        AlertVariation {
            id: "var_boosty".to_string(),
            name: "Поддержка с Boosty".to_string(),
            enabled: true,
            priority: 90,
            source_filter: "Boosty".to_string(),
            event_kind: None,
            min_amount: 0.0,
            max_amount: None,
            keyword: "".to_string(),
            image_url: "".to_string(),
            sound_url: "".to_string(),
            sound_id: "alert".to_string(),
            title_template: "BOOSTY · {user} ({amount} {currency})".to_string(),
            tts_template: "Спасибо за поддержку на Бусти, {user}! {message}".to_string(),
            duration_ms: 5000,
            animation: "slide_up".to_string(),
            bg_color: "rgba(24, 15, 12, 0.92)".to_string(),
            accent_color: "#F97316".to_string(),
            text_color: "#FFF7ED".to_string(),
        },
        AlertVariation {
            id: "var_default".to_string(),
            name: "Базовый алерт".to_string(),
            enabled: true,
            priority: 1,
            source_filter: "".to_string(),
            event_kind: None,
            min_amount: 0.0,
            max_amount: None,
            keyword: "".to_string(),
            image_url: "".to_string(),
            sound_url: "".to_string(),
            sound_id: "coin".to_string(),
            title_template: "{user} · {amount} {currency}".to_string(),
            tts_template: "{user} отправил {amount} {currency}. {message}".to_string(),
            duration_ms: 4500,
            animation: "pop".to_string(),
            bg_color: "rgba(9, 13, 28, 0.88)".to_string(),
            accent_color: "#3B82F6".to_string(),
            text_color: "#F8FAFC".to_string(),
        },
    ]
}
