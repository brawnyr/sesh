mod audio;

use audio::{AudioController, DeviceState, InputDevice, TakeInfo};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State, WindowEvent};

pub struct AppState {
    audio: Mutex<Option<AudioController>>,
    takes_dir: Mutex<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub takes_dir: String,
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
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    } else {
        p
    };
    open_path(&target).map_err(|e| e.to_string())
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
    let initial_dir = audio::default_takes_dir();
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
