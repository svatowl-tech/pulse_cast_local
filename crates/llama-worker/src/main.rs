//! Изолированный CLI-воркер для встроенного локального GGUF-инференса (`llama-cpp-2`).
//! Вынесен в отдельный бинарник во избежание конфликта C/C++ символов `ggml`/`gguf`
//! между `llama-cpp-sys-2` и `whisper-rs-sys` при статической линковке.

#[allow(deprecated)]
use llama_cpp_2::model::Special;
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::Read,
    num::NonZeroU32,
    path::Path,
};

#[derive(Debug, Deserialize)]
struct WorkerRequest {
    model_path: String,
    prompt: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct WorkerToolCall {
    name: String,
    arguments: Value,
}

#[derive(Debug, Serialize)]
struct WorkerResponse {
    ok: bool,
    reply: Option<String>,
    tool_calls: Vec<WorkerToolCall>,
    error: Option<String>,
}

impl WorkerResponse {
    fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            reply: None,
            tool_calls: Vec::new(),
            error: Some(msg.into()),
        }
    }
}

fn main() {
    let mut input = String::new();
    if let Err(err) = std::io::stdin().read_to_string(&mut input) {
        emit(&WorkerResponse::err(format!("Ошибка чтения stdin: {}", err)));
        return;
    }

    let req: WorkerRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(err) => {
            emit(&WorkerResponse::err(format!("Некорректный JSON-запрос: {}", err)));
            return;
        }
    };

    match run_inference(&req.model_path, &req.prompt) {
        Ok((reply, tool_calls)) => emit(&WorkerResponse {
            ok: true,
            reply: Some(reply),
            tool_calls,
            error: None,
        }),
        Err(err) => emit(&WorkerResponse::err(err)),
    }
}

fn emit(resp: &WorkerResponse) {
    if let Ok(json_str) = serde_json::to_string(resp) {
        println!("{}", json_str);
    } else {
        println!("{{\"ok\":false,\"reply\":null,\"tool_calls\":[],\"error\":\"serialize_failed\"}}");
    }
}

#[allow(deprecated)]
fn run_inference(model_path: &str, user_prompt: &str) -> Result<(String, Vec<WorkerToolCall>), String> {
    if !Path::new(model_path).exists() {
        return Err(format!("Файл GGUF-модели не найден: {}", model_path));
    }

    let backend = LlamaBackend::init().map_err(|e| format!("LlamaBackend::init: {:?}", e))?;
    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("load_from_file: {:?}", e))?;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(NonZeroU32::new(2048).expect("non-zero ctx")));
    let mut ctx = model
        .new_context(&backend, ctx_params)
        .map_err(|e| format!("new_context: {:?}", e))?;

    let system_prompt = format!(
        "Верни ТОЛЬКО JSON: {{\"reply\":\"...\",\"tool_calls\":[{{\"name\":\"...\",\"arguments\":{{...}}}}]}}. Доступные инструменты: change_scene, trigger_alert, send_chat_message, toggle_subtitles, set_theme, play_sound, start_minigame, avatar_action, toggle_plugin, configure_plugin, trigger_plugin_effect, upsert_custom_plugin, update_widget_layout. Запрос: {}\nJSON:",
        user_prompt
    );

    let tokens = model
        .str_to_token(&system_prompt, AddBos::Always)
        .map_err(|e| format!("str_to_token: {:?}", e))?;

    let mut batch = LlamaBatch::new(2048, 1);
    let last_idx = tokens.len().saturating_sub(1);
    for (i, &tok) in tokens.iter().enumerate() {
        batch
            .add(tok, i as i32, &[0], i == last_idx)
            .map_err(|e| format!("batch.add: {:?}", e))?;
    }
    ctx.decode(&mut batch).map_err(|e| format!("decode: {:?}", e))?;

    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(0.2),
        LlamaSampler::dist(42),
    ]);

    let mut raw_out = String::new();
    let mut n_cur = tokens.len() as i32;
    for _ in 0..256 {
        let tok = sampler.sample(&ctx, batch.n_tokens() - 1);
        if model.is_eog_token(tok) {
            break;
        }
        if let Ok(piece) = model.token_to_str(tok, Special::Plaintext) {
            raw_out.push_str(&piece);
            if raw_out.trim_end().ends_with('}') && parse_model_output(&raw_out).is_ok() {
                break;
            }
        }
        batch.clear();
        batch
            .add(tok, n_cur, &[0], true)
            .map_err(|e| format!("batch.add step: {:?}", e))?;
        n_cur += 1;
        ctx.decode(&mut batch).map_err(|e| format!("decode step: {:?}", e))?;
    }

    parse_model_output(&raw_out)
}

fn parse_model_output(raw: &str) -> Result<(String, Vec<WorkerToolCall>), String> {
    let trimmed = raw.trim();
    let candidate = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };

    let parsed: Value = serde_json::from_str(candidate)
        .map_err(|_| format!("Модель вернула не-JSON ответ: {}", trimmed))?;
    let reply = parsed["reply"]
        .as_str()
        .unwrap_or("Выполнено локальной моделью.")
        .to_string();

    let mut calls = Vec::new();
    if let Some(arr) = parsed["tool_calls"].as_array() {
        for tc in arr {
            let name = tc["name"].as_str().unwrap_or("").to_string();
            let arguments = tc["arguments"].clone();
            if !name.is_empty() {
                calls.push(WorkerToolCall { name, arguments });
            }
        }
    }

    Ok((reply, calls))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_plain_and_fenced_json_output() {
        let raw = "```json\n{\"reply\":\"Сцена переключена\",\"tool_calls\":[{\"name\":\"change_scene\",\"arguments\":{\"scene\":\"Main Studio\"}}]}\n```";
        let (reply, calls) = parse_model_output(raw).expect("valid json payload");
        assert_eq!(reply, "Сцена переключена");
        assert_eq!(
            calls,
            vec![WorkerToolCall {
                name: "change_scene".to_string(),
                arguments: json!({ "scene": "Main Studio" }),
            }]
        );
    }
}
