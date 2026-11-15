//! Модуль потоковых субтитров на базе `cpal` (захват аудио), `hound` (WAV) и `whisper-rs`.
//! Выполняет обязательную линковку `whisper-rs` и `cpal` с безопасной обработкой
//! отсутствующих микрофонов или файлов моделей на этапе запуска.

use crate::state::{AppState, WhisperStatus, WsBroadcast};
use chrono::Utc;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Целевая частота дискретизации для Whisper (16 кГц моно f32).
const WHISPER_SAMPLE_RATE: u32 = 16_000;
/// Длина окна накопления аудио перед распознаванием (3 секунды = 48 000 сэмплов).
const WINDOW_SAMPLES: usize = (WHISPER_SAMPLE_RATE as usize) * 3;
/// Порог тишины (RMS), ниже которого фрейм не отправляется в Whisper.
const VAD_RMS_THRESHOLD: f32 = 0.008;

/// Контроллер подсистемы распознавания речи.
pub struct WhisperController {
    model_path: PathBuf,
    running: Arc<AtomicBool>,
    language: String,
}

impl WhisperController {
    /// Создаёт контроллер субтитров с указанным путём к GGML-модели Whisper.
    pub fn new(model_path: PathBuf, language: String) -> Arc<Self> {
        Arc::new(Self {
            model_path,
            running: Arc::new(AtomicBool::new(false)),
            language,
        })
    }

    /// Переключает состояние микрофонного захвата и распознавания.
    pub async fn set_enabled(&self, state: &Arc<AppState>, enabled: bool) -> WhisperStatus {
        if !enabled {
            self.running.store(false, Ordering::SeqCst);
            return self
                .update_status(state, false, false, "Субтитры остановлены пользователем")
                .await;
        }

        if self.running.load(Ordering::SeqCst) {
            return state.snapshot.read().await.whisper.clone();
        }

        if !self.model_path.exists() {
            let msg = format!(
                "Модель Whisper не найдена по пути '{}'. Положите ggml-*.bin или отправьте WAV-файл.",
                self.model_path.display()
            );
            state.push_log("warn", "whisper", &msg).await;
            return self.update_status(state, false, false, msg).await;
        }

        self.running.store(true, Ordering::SeqCst);
        let running_flag = Arc::clone(&self.running);
        let model_path = self.model_path.clone();
        let language = self.language.clone();
        let state_clone = Arc::clone(state);

        // Запускаем фоновую задачу захвата аудио и инференса Whisper
        tokio::spawn(async move {
            if let Err(err) = run_capture_pipeline(state_clone.clone(), running_flag.clone(), model_path, language).await {
                running_flag.store(false, Ordering::SeqCst);
                let msg = format!("Ошибка аудиоконвейера Whisper: {}", err);
                state_clone.push_log("error", "whisper", &msg).await;
                let mut guard = state_clone.snapshot.write().await;
                guard.whisper.enabled = false;
                guard.whisper.audio_device_active = false;
                guard.whisper.diagnostic = msg;
                let status = guard.whisper.clone();
                drop(guard);
                let _ = state_clone.tx.send(WsBroadcast::WhisperStatusUpdated(status));
            }
        });

        self.update_status(state, true, true, "Захват микрофона и Whisper запущены")
            .await
    }

    /// Распознаёт загруженный WAV-буфер (через `hound`) без микрофона — удобно для тестов и локальных клипов.
    pub async fn transcribe_wav_bytes(&self, state: &Arc<AppState>, wav_bytes: &[u8]) -> Result<String, String> {
        let samples = decode_wav_to_16k_mono(wav_bytes)?;
        if !self.model_path.exists() {
            let fallback = format!(
                "[WAV декодирован: {} сэмплов @ 16кГц; для реального текста скачайте {}]",
                samples.len(),
                self.model_path.display()
            );
            self.emit_subtitle(state, fallback.clone(), true).await;
            return Ok(fallback);
        }

        let model_path = self.model_path.clone();
        let lang = self.language.clone();
        let text = tokio::task::spawn_blocking(move || run_whisper_inference(&model_path, &lang, &samples))
            .await
            .map_err(|e| format!("Сбой рабочего потока Whisper: {}", e))??;

        if !text.is_empty() {
            self.emit_subtitle(state, text.clone(), true).await;
        }
        Ok(text)
    }

    async fn emit_subtitle(&self, state: &Arc<AppState>, text: String, is_final: bool) {
        {
            let mut guard = state.snapshot.write().await;
            guard.whisper.last_transcript = text.clone();
        }
        let _ = state.tx.send(WsBroadcast::Subtitle {
            text,
            is_final,
            timestamp: Utc::now(),
        });
    }

    async fn update_status(
        &self,
        state: &Arc<AppState>,
        enabled: bool,
        audio_active: bool,
        diagnostic: impl Into<String>,
    ) -> WhisperStatus {
        let model_loaded = self.model_path.exists();
        let status = {
            let mut guard = state.snapshot.write().await;
            guard.whisper.enabled = enabled;
            guard.whisper.model_loaded = model_loaded;
            guard.whisper.audio_device_active = audio_active;
            guard.whisper.diagnostic = diagnostic.into();
            guard.whisper.clone()
        };
        let _ = state.tx.send(WsBroadcast::WhisperStatusUpdated(status.clone()));
        status
    }
}

/// Основной цикл захвата микрофона через `cpal` и распознавания через `whisper-rs`.
async fn run_capture_pipeline(
    state: Arc<AppState>,
    running: Arc<AtomicBool>,
    model_path: PathBuf,
    language: String,
) -> Result<(), String> {
    let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<f32>>(16);

    // Инициализируем аудиоустройство в отдельном потоке, так как `cpal::Stream` не Send на некоторых ОС
    let flag_audio = Arc::clone(&running);
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let Some(device) = host.default_input_device() else {
            tracing::warn!("Микрофон (input device) не найден в системе");
            flag_audio.store(false, Ordering::SeqCst);
            return;
        };
        let Ok(config) = device.default_input_config() else {
            tracing::warn!("Не удалось получить конфигурацию микрофона");
            flag_audio.store(false, Ordering::SeqCst);
            return;
        };

        let src_rate = config.sample_rate();
        let channels = config.channels() as usize;
        let mut ring_buffer: Vec<f32> = Vec::with_capacity(WINDOW_SAMPLES);

        let stream_res = device.build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                // Сводим многоканальный звук в моно и ресемплируем к 16 кГц
                let mono = downmix_to_mono(data, channels);
                let resampled = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE);
                ring_buffer.extend_from_slice(&resampled);

                if ring_buffer.len() >= WINDOW_SAMPLES {
                    let chunk = ring_buffer.drain(..WINDOW_SAMPLES).collect::<Vec<f32>>();
                    let _ = audio_tx.try_send(chunk);
                }
            },
            |err| tracing::error!("Ошибка потока захвата аудио cpal: {}", err),
            None,
        );

        match stream_res {
            Ok(stream) => {
                if stream.play().is_ok() {
                    while flag_audio.load(Ordering::SeqCst) {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                    }
                }
            }
            Err(err) => {
                tracing::error!("Не удалось открыть аудиопоток cpal: {}", err);
                flag_audio.store(false, Ordering::SeqCst);
            }
        }
    });

    // В отдельном блокирующем потоке держим загруженный контекст Whisper и обрабатываем окна
    while running.load(Ordering::SeqCst) {
        let Some(chunk) = audio_rx.recv().await else {
            break;
        };
        if compute_rms(&chunk) < VAD_RMS_THRESHOLD {
            continue;
        }

        let mp = model_path.clone();
        let lang = language.clone();
        match tokio::task::spawn_blocking(move || run_whisper_inference(&mp, &lang, &chunk)).await {
            Ok(Ok(text)) if !text.trim().is_empty() => {
                {
                    let mut guard = state.snapshot.write().await;
                    guard.whisper.last_transcript = text.clone();
                }
                let _ = state.tx.send(WsBroadcast::Subtitle {
                    text,
                    is_final: true,
                    timestamp: Utc::now(),
                });
            }
            Ok(Err(err)) => {
                state.push_log("error", "whisper", err).await;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Запускает инференс `whisper-rs` 0.16 поверх массива 16 кГц моно `f32`.
pub fn run_whisper_inference(model_path: &Path, language: &str, samples: &[f32]) -> Result<String, String> {
    let path_str = model_path.to_str().ok_or("Некорректный UTF-8 путь к модели Whisper")?;
    let ctx = WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
        .map_err(|e| format!("Ошибка загрузки WhisperContext: {:?}", e))?;
    let mut w_state = ctx
        .create_state()
        .map_err(|e| format!("Ошибка создания WhisperState: {:?}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    w_state
        .full(params, samples)
        .map_err(|e| format!("Ошибка инференса Whisper: {:?}", e))?;

    let mut output = String::new();
    for seg in w_state.as_iter() {
        if let Ok(txt) = seg.to_str_lossy() {
            output.push_str(txt.trim());
            output.push(' ');
        }
    }
    Ok(output.trim().to_string())
}

/// Декодирует WAV-файл через `hound` и приводит к 16 кГц моно `f32`.
pub fn decode_wav_to_16k_mono(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut reader = hound::WavReader::new(cursor).map_err(|e| format!("Некорректный WAV: {}", e))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    let raw_f32: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .filter_map(Result::ok)
            .collect(),
        hound::SampleFormat::Int => {
            let max_val = (1_i64 << (spec.bits_per_sample.saturating_sub(1))) as f32;
            reader
                .samples::<i32>()
                .filter_map(Result::ok)
                .map(|s| s as f32 / max_val.max(1.0))
                .collect()
        }
    };

    let mono = downmix_to_mono(&raw_f32, channels);
    Ok(resample_linear(&mono, spec.sample_rate, WHISPER_SAMPLE_RATE))
}

/// Записывает аудиофрагмент в WAV-файл на диске с помощью `hound`.
pub fn save_wav_16k_mono(path: &Path, samples: &[f32]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: WHISPER_SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| format!("Ошибка создания WAV: {}", e))?;
    for &sample in samples {
        writer.write_sample(sample).map_err(|e| format!("Ошибка записи сэмпла: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("Ошибка финализации WAV: {}", e))
}

fn downmix_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == dst_rate || src_rate == 0 {
        return input.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let out_len = ((input.len() as f64) / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = (i as f64) * ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}
