//! Модуль пресетов тем оформления, стандартных плагинов оверлея и макета виджетов.
//! Включает эталонные реализации «Падающих звёздочек» и «Чоков из чата» на Canvas/DOM SDK.

use crate::state::{OverlayPlugin, SuperThemePackage, ThemeConfig, WidgetLayoutConfig};

/// Возвращает стандартные темы оформления для дашборда и оверлея OBS.
pub fn default_themes() -> Vec<ThemeConfig> {
    vec![
        ThemeConfig {
            id: "studio_dark".to_string(),
            name: "Тёмная студийная".to_string(),
            target: "dashboard".to_string(),
            mode: "dark".to_string(),
            bg_canvas: "#0B0F17".to_string(),
            bg_surface: "#111827".to_string(),
            border_color: "#1F2937".to_string(),
            text_primary: "#F1F5F9".to_string(),
            text_muted: "#94A3B8".to_string(),
            accent_color: "#2563EB".to_string(),
            border_radius_px: 10,
            overlay_opacity: 0.95,
        },
        ThemeConfig {
            id: "studio_light".to_string(),
            name: "Светлая студийная".to_string(),
            target: "dashboard".to_string(),
            mode: "light".to_string(),
            bg_canvas: "#F8FAFC".to_string(),
            bg_surface: "#FFFFFF".to_string(),
            border_color: "#E2E8F0".to_string(),
            text_primary: "#0F172A".to_string(),
            text_muted: "#64748B".to_string(),
            accent_color: "#2563EB".to_string(),
            border_radius_px: 10,
            overlay_opacity: 0.95,
        },
        ThemeConfig {
            id: "overlay_transparent".to_string(),
            name: "Прозрачный эфир (OBS)".to_string(),
            target: "overlay".to_string(),
            mode: "dark".to_string(),
            bg_canvas: "transparent".to_string(),
            bg_surface: "rgba(15, 23, 42, 0.78)".to_string(),
            border_color: "rgba(148, 163, 184, 0.25)".to_string(),
            text_primary: "#F8FAFC".to_string(),
            text_muted: "#CBD5E1".to_string(),
            accent_color: "#3B82F6".to_string(),
            border_radius_px: 12,
            overlay_opacity: 0.88,
        },
        ThemeConfig {
            id: "overlay_neon".to_string(),
            name: "Неоновый HUD".to_string(),
            target: "overlay".to_string(),
            mode: "dark".to_string(),
            bg_canvas: "transparent".to_string(),
            bg_surface: "rgba(9, 13, 28, 0.85)".to_string(),
            border_color: "rgba(56, 189, 248, 0.55)".to_string(),
            text_primary: "#F0F9FF".to_string(),
            text_muted: "#7DD3FC".to_string(),
            accent_color: "#06B6D4".to_string(),
            border_radius_px: 8,
            overlay_opacity: 0.92,
        },
        ThemeConfig {
            id: "overlay_minimal".to_string(),
            name: "Минимал-титр".to_string(),
            target: "overlay".to_string(),
            mode: "light".to_string(),
            bg_canvas: "transparent".to_string(),
            bg_surface: "rgba(255, 255, 255, 0.90)".to_string(),
            border_color: "rgba(15, 23, 42, 0.14)".to_string(),
            text_primary: "#0F172A".to_string(),
            text_muted: "#475569".to_string(),
            accent_color: "#2563EB".to_string(),
            border_radius_px: 14,
            overlay_opacity: 0.95,
        },
    ]
}

/// Возвращает встроенные эталонные плагины SDK (с готовым рабочим кодом для оверлея).
pub fn default_plugins() -> Vec<OverlayPlugin> {
    vec![
        OverlayPlugin {
            id: "starfall".to_string(),
            name: "Падающие звёздочки".to_string(),
            description: "Плавный поток звёзд и искр на фоне с салютом при донатах и триггерах.".to_string(),
            author: "PulseCast SDK".to_string(),
            enabled: true,
            builtin: true,
            z_index: 5,
            config: serde_json::json!({
                "count": 28,
                "speed": 1.4,
                "color": "#FBBF24",
                "secondaryColor": "#38BDF8",
                "burstOnDonate": 35
            }),
            hooks: vec!["on_tick".to_string(), "on_donation".to_string(), "on_trigger".to_string()],
            style_css: "".to_string(),
            script_js: r#"// Плагин: Падающие звёздочки на Canvas 2D SDK
const stars = state.stars || (state.stars = Array.from({ length: cfg.count || 28 }, () => ({
  x: Math.random() * width,
  y: Math.random() * height,
  r: 1.5 + Math.random() * 2.8,
  vy: (0.6 + Math.random() * 1.4) * (cfg.speed || 1.4),
  vx: (Math.random() - 0.5) * 0.4,
  alpha: 0.4 + Math.random() * 0.6,
  color: Math.random() > 0.35 ? (cfg.color || '#FBBF24') : (cfg.secondaryColor || '#38BDF8')
})));

if (event && (event.type === 'on_donation' || event.type === 'on_trigger')) {
  const burst = (event.payload && event.payload.burst) || cfg.burstOnDonate || 35;
  for (let i = 0; i < burst; i++) {
    stars.push({
      x: width * (0.2 + Math.random() * 0.6),
      y: -10 - Math.random() * 60,
      r: 2.5 + Math.random() * 3.5,
      vy: 2.5 + Math.random() * 3.0,
      vx: (Math.random() - 0.5) * 2.4,
      alpha: 1,
      temp: true,
      color: cfg.color || '#FBBF24'
    });
  }
}

for (let i = stars.length - 1; i >= 0; i--) {
  const s = stars[i];
  s.x += s.vx;
  s.y += s.vy;
  if (s.y > height + 12) {
    if (s.temp) { stars.splice(i, 1); continue; }
    s.y = -8;
    s.x = Math.random() * width;
  }
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}"#.to_string(),
        },
        OverlayPlugin {
            id: "chat_runners".to_string(),
            name: "Чоки из чата (Stream Avatars)".to_string(),
            description: "Отрисовывает бегающих по низу экрана персонажей зрителей с экипировкой, облачками сообщений и реакцией на команды.".to_string(),
            author: "PulseCast SDK".to_string(),
            enabled: true,
            builtin: true,
            z_index: 25,
            config: serde_json::json!({
                "floorOffsetPx": 18,
                "bubbleDurationMs": 4500,
                "showNametags": true
            }),
            hooks: vec!["on_tick".to_string(), "on_chat".to_string(), "on_donation".to_string()],
            style_css: "".to_string(),
            script_js: r#"// Плагин: Рендер эффектов вокруг бегающих чоков (интеграция с ареной аватаров)
if (event && event.type === 'on_chat' && event.payload && event.payload.text) {
  const txt = String(event.payload.text).toLowerCase();
  if (txt.includes('бум') || txt.includes('boom')) {
    sdk.spawnParticles(width * 0.5, height - 60, 24, '#F97316');
  }
}"#.to_string(),
        },
        OverlayPlugin {
            id: "word_boom".to_string(),
            name: "Реакция на слово «бум»".to_string(),
            description: "Взрыв частиц и лёгкая вспышка рамки при появлении ключевого слова в чате.".to_string(),
            author: "Community Example".to_string(),
            enabled: false,
            builtin: false,
            z_index: 30,
            config: serde_json::json!({
                "keyword": "бум",
                "particleColor": "#EF4444"
            }),
            hooks: vec!["on_chat".to_string()],
            style_css: "".to_string(),
            script_js: r#"if (event && event.type === 'on_chat' && event.payload) {
  const kw = String(cfg.keyword || 'бум').toLowerCase();
  if (String(event.payload.text || '').toLowerCase().includes(kw)) {
    sdk.spawnParticles(Math.random() * width, height * 0.75, 36, cfg.particleColor || '#EF4444');
  }
}"#.to_string(),
        },
    ]
}

/// Возвращает стартовую раскладку и обёртки виджетов на OBS-оверлее.
pub fn default_layouts() -> Vec<WidgetLayoutConfig> {
    vec![
        WidgetLayoutConfig {
            widget_id: "alerts".to_string(),
            label: "Окно алертов".to_string(),
            visible: true,
            x_pct: 50.0,
            y_pct: 16.0,
            scale: 1.0,
            z_index: 40,
            wrapper_preset: "neon_frame".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "goal".to_string(),
            label: "Цель сборов".to_string(),
            visible: true,
            x_pct: 4.0,
            y_pct: 4.0,
            scale: 1.0,
            z_index: 20,
            wrapper_preset: "minimal_edge".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "subathon".to_string(),
            label: "Subathon-таймер".to_string(),
            visible: true,
            x_pct: 76.0,
            y_pct: 4.0,
            scale: 1.0,
            z_index: 20,
            wrapper_preset: "glass_bar".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "counters".to_string(),
            label: "Hype Train & Счётчики".to_string(),
            visible: true,
            x_pct: 36.0,
            y_pct: 4.0,
            scale: 1.0,
            z_index: 22,
            wrapper_preset: "glass_bar".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "chat".to_string(),
            label: "Мультичат".to_string(),
            visible: true,
            x_pct: 4.0,
            y_pct: 34.0,
            scale: 1.0,
            z_index: 20,
            wrapper_preset: "glass_bar".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "alerts_list".to_string(),
            label: "Лента последних донатов".to_string(),
            visible: true,
            x_pct: 74.0,
            y_pct: 18.0,
            scale: 1.0,
            z_index: 18,
            wrapper_preset: "minimal_edge".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "pngtuber".to_string(),
            label: "2D PNGTuber-аватар".to_string(),
            visible: true,
            x_pct: 84.0,
            y_pct: 58.0,
            scale: 1.0,
            z_index: 32,
            wrapper_preset: "none".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "subtitles".to_string(),
            label: "Субтитры Whisper".to_string(),
            visible: true,
            x_pct: 50.0,
            y_pct: 84.0,
            scale: 1.0,
            z_index: 35,
            wrapper_preset: "retro_crt".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "media_share".to_string(),
            label: "Плеер Media Share".to_string(),
            visible: true,
            x_pct: 72.0,
            y_pct: 40.0,
            scale: 1.0,
            z_index: 30,
            wrapper_preset: "neon_frame".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "prediction".to_string(),
            label: "Пари и ставки (!bet)".to_string(),
            visible: true,
            x_pct: 4.0,
            y_pct: 66.0,
            scale: 1.0,
            z_index: 25,
            wrapper_preset: "glass_bar".to_string(),
            custom_css: "".to_string(),
        },
        WidgetLayoutConfig {
            widget_id: "ticker".to_string(),
            label: "Бегущая строка / Таймер".to_string(),
            visible: true,
            x_pct: 0.0,
            y_pct: 94.0,
            scale: 1.0,
            z_index: 30,
            wrapper_preset: "glass_bar".to_string(),
            custom_css: "".to_string(),
        },
    ]
}

/// Возвращает пакеты оформления SuperThemes в 1 клик.
pub fn default_super_themes() -> Vec<SuperThemePackage> {
    vec![
        SuperThemePackage {
            id: "cyberpunk_hud".to_string(),
            name: "Cyberpunk Neon HUD".to_string(),
            description: "Яркий неоновый HUD с падающими искрами и футуристичными рамками.".to_string(),
            category: "Киберпанк / Шутеры".to_string(),
            accent_color: "#06B6D4".to_string(),
            bg_surface: "rgba(9, 13, 28, 0.88)".to_string(),
            border_color: "rgba(6, 182, 212, 0.55)".to_string(),
            wrapper_preset: "neon_frame".to_string(),
            enable_starfall: true,
        },
        SuperThemePackage {
            id: "cozy_lofi".to_string(),
            name: "Cozy Lo-Fi Evening".to_string(),
            description: "Тёплое полупрозрачное стекло для Just Chatting, арта и ламповых стримов.".to_string(),
            category: "Just Chatting / Cozy".to_string(),
            accent_color: "#F59E0B".to_string(),
            bg_surface: "rgba(28, 22, 18, 0.82)".to_string(),
            border_color: "rgba(245, 158, 11, 0.40)".to_string(),
            wrapper_preset: "glass_bar".to_string(),
            enable_starfall: false,
        },
        SuperThemePackage {
            id: "esports_pro".to_string(),
            name: "Esports Pro Broadcast".to_string(),
            description: "Строгие контрастные титры и плашки с минималистичными отступами.".to_string(),
            category: "Киберспорт / Турниры".to_string(),
            accent_color: "#2563EB".to_string(),
            bg_surface: "rgba(15, 23, 42, 0.90)".to_string(),
            border_color: "rgba(59, 130, 246, 0.45)".to_string(),
            wrapper_preset: "minimal_edge".to_string(),
            enable_starfall: false,
        },
        SuperThemePackage {
            id: "retro_arcade".to_string(),
            name: "Retro CRT Arcade".to_string(),
            description: "Олдскульный пиксельный терминал с зелёной CRT-рамкой и частицами.".to_string(),
            category: "Ретро / Инди".to_string(),
            accent_color: "#22C55E".to_string(),
            bg_surface: "rgba(6, 12, 18, 0.92)".to_string(),
            border_color: "rgba(34, 197, 94, 0.65)".to_string(),
            wrapper_preset: "retro_crt".to_string(),
            enable_starfall: true,
        },
    ]
}

