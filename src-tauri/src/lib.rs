mod audio;

use audio::{AudioController, DeviceState, InputDevice, TakeInfo};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, State, WindowEvent};

pub struct AppState {
    audio: Mutex<Option<AudioController>>,
    takes_dir: Mutex<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub takes_dir: String,
}

/// JSON shape written to disk. Forward-compatible: new optional fields can be
/// appended without breaking older configs (serde defaults them to `None`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct StoredSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    takes_dir: Option<String>,
}

/// Absolute path to the settings JSON. `None` only if `dirs::config_dir()`
/// returns nothing (very rare — headless / unusual environments).
fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("sesh").join("settings.json"))
}

fn load_stored_settings() -> StoredSettings {
    let Some(path) = settings_path() else {
        return StoredSettings::default();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return StoredSettings::default();
    };
    serde_json::from_str::<StoredSettings>(&text).unwrap_or_default()
}

/// Persist the entire settings blob. Caller is responsible for merging with
/// any previously-stored fields before calling — we overwrite atomically.
fn write_stored_settings(stored: &StoredSettings) -> std::io::Result<()> {
    let Some(path) = settings_path() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no config dir",
        ));
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(stored)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&path, text)
}

fn persist_takes_dir(dir: &Path) {
    let mut stored = load_stored_settings();
    stored.takes_dir = Some(dir.to_string_lossy().to_string());
    if let Err(e) = write_stored_settings(&stored) {
        eprintln!("failed to write settings.json: {}", e);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeMeta {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub modified_unix: u64,
}

fn with_audio<R>(
    state: &State<AppState>,
    f: impl FnOnce(&AudioController) -> Result<R, String>,
) -> Result<R, String> {
    let guard = state.audio.lock();
    let audio = guard.as_ref().ok_or_else(|| "audio not ready".to_string())?;
    f(audio)
}

#[tauri::command]
fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    audio::list_input_devices().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    let dir = state.takes_dir.lock().clone();
    Settings {
        takes_dir: dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn set_takes_dir(state: State<AppState>, dir: String) -> Result<Settings, String> {
    let path = PathBuf::from(&dir);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    *state.takes_dir.lock() = path.clone();
    // Best-effort persist; we already have the chosen dir live in memory.
    persist_takes_dir(&path);
    Ok(Settings {
        takes_dir: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn set_input_device(
    state: State<AppState>,
    device_name: Option<String>,
) -> Result<DeviceState, String> {
    with_audio(&state, |audio| audio.set_device(device_name))
}

#[tauri::command]
fn start_recording(state: State<AppState>) -> Result<TakeInfo, String> {
    let takes_dir = state.takes_dir.lock().clone();
    with_audio(&state, |audio| audio.start_recording(takes_dir))
}

#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<TakeInfo, String> {
    with_audio(&state, |audio| audio.stop_recording())
}

#[tauri::command]
fn is_recording(state: State<AppState>) -> bool {
    state
        .audio
        .lock()
        .as_ref()
        .map(|a| a.is_recording())
        .unwrap_or(false)
}

#[tauri::command]
fn list_takes(state: State<AppState>) -> Result<Vec<TakeMeta>, String> {
    let dir = state.takes_dir.lock().clone();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut takes: Vec<TakeMeta> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("wav") {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        takes.push(TakeMeta {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            bytes: metadata.len(),
            modified_unix: modified,
        });
    }
    takes.sort_by(|a, b| b.modified_unix.cmp(&a.modified_unix));
    Ok(takes)
}

#[tauri::command]
fn reveal_in_folder(state: State<AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    } else {
        p
    };
    let takes_dir = state.takes_dir.lock().clone();
    let allowed = fs::canonicalize(&takes_dir).map_err(|e| e.to_string())?;
    let resolved = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !resolved.starts_with(&allowed) {
        return Err("path outside takes_dir".to_string());
    }
    open_path(&resolved).map_err(|e| e.to_string())
}

fn open_path(path: &std::path::Path) -> std::io::Result<()> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Prefer the previously-saved takes_dir if it still resolves to a real
    // directory; otherwise fall back to the default and create it.
    let stored = load_stored_settings();
    let initial_dir = stored
        .takes_dir
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(audio::default_takes_dir);
    let _ = fs::create_dir_all(&initial_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            audio: Mutex::new(None),
            takes_dir: Mutex::new(initial_dir),
        })
        .invoke_handler(tauri::generate_handler![
            list_input_devices,
            get_settings,
            set_takes_dir,
            set_input_device,
            start_recording,
            stop_recording,
            is_recording,
            list_takes,
            reveal_in_folder,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let controller = AudioController::spawn(handle);
            let state = app.state::<AppState>();
            *state.audio.lock() = Some(controller);
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running sesh");
}
