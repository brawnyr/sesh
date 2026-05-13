use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use crossbeam_channel::{bounded, unbounded, Receiver, Sender};
use hound::{SampleFormat as WavFormat, WavSpec, WavWriter};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs::create_dir_all;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InputDevice {
    pub name: String,
    pub is_default: bool,
    pub channels: u16,
    pub sample_rate: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeviceState {
    pub name: String,
    pub channels: u16,
    pub sample_rate: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeInfo {
    pub path: String,
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f32,
    pub started_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MeterReading {
    pub peak_db: f32,
    pub rms_db: f32,
    pub clipped: bool,
}

enum Sample {
    F32(Vec<f32>),
    I16(Vec<i16>),
    U16(Vec<u16>),
    I32(Vec<i32>),
}

impl Sample {
    fn analyze(&self) -> (f32, f64, usize, bool) {
        let mut peak: f32 = 0.0;
        let mut sumsq: f64 = 0.0;
        let mut clipped = false;
        match self {
            Sample::F32(b) => {
                for s in b {
                    let v = *s;
                    let a = v.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a >= CLIP_THRESHOLD {
                        clipped = true;
                    }
                    sumsq += (v as f64) * (v as f64);
                }
                (peak, sumsq, b.len(), clipped)
            }
            Sample::I16(b) => {
                let scale = 1.0 / i16::MAX as f32;
                for s in b {
                    let v = (*s as f32) * scale;
                    let a = v.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a >= CLIP_THRESHOLD {
                        clipped = true;
                    }
                    sumsq += (v as f64) * (v as f64);
                }
                (peak, sumsq, b.len(), clipped)
            }
            Sample::U16(b) => {
                let scale = 1.0 / i16::MAX as f32;
                for s in b {
                    let centered = *s as i32 - i16::MAX as i32 - 1;
                    let signed =
                        centered.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                    let v = (signed as f32) * scale;
                    let a = v.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a >= CLIP_THRESHOLD {
                        clipped = true;
                    }
                    sumsq += (v as f64) * (v as f64);
                }
                (peak, sumsq, b.len(), clipped)
            }
            Sample::I32(b) => {
                let scale = 1.0 / i32::MAX as f32;
                for s in b {
                    let v = (*s as f32) * scale;
                    let a = v.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a >= CLIP_THRESHOLD {
                        clipped = true;
                    }
                    sumsq += (v as f64) * (v as f64);
                }
                (peak, sumsq, b.len(), clipped)
            }
        }
    }

    fn write_to<W: std::io::Write + std::io::Seek>(
        &self,
        writer: &mut WavWriter<W>,
    ) -> Result<()> {
        match self {
            Sample::F32(b) => {
                for s in b {
                    writer.write_sample(*s)?;
                }
            }
            Sample::I16(b) => {
                for s in b {
                    writer.write_sample(*s)?;
                }
            }
            Sample::U16(b) => {
                for s in b {
                    let centered = *s as i32 - i16::MAX as i32 - 1;
                    let signed =
                        centered.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                    writer.write_sample(signed)?;
                }
            }
            Sample::I32(b) => {
                for s in b {
                    writer.write_sample(*s)?;
                }
            }
        }
        Ok(())
    }
}

const DB_FLOOR: f32 = -90.0;
const CLIP_THRESHOLD: f32 = 0.997;
type AnyWavWriter = WavWriter<BufWriter<std::fs::File>>;

fn to_db(linear: f32) -> f32 {
    if linear <= 1e-9 {
        DB_FLOOR
    } else {
        (20.0 * linear.log10()).max(DB_FLOOR)
    }
}

struct ActiveWriter {
    writer: AnyWavWriter,
    path: PathBuf,
    sample_rate: u32,
    channels: u16,
    frames_written: u64,
    started_at: chrono::DateTime<chrono::Local>,
}

impl ActiveWriter {
    fn finalize(self) -> Result<TakeInfo> {
        let ActiveWriter {
            writer,
            path,
            sample_rate,
            channels,
            frames_written,
            started_at,
        } = self;
        writer.finalize()?;
        Ok(TakeInfo {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            sample_rate,
            channels,
            duration_seconds: frames_written as f32 / sample_rate as f32,
            started_at: started_at.to_rfc3339(),
        })
    }
}

type WriterSlot = Arc<Mutex<Option<ActiveWriter>>>;

// Commands sent into the audio worker thread.
pub enum AudioCmd {
    SetDevice {
        name: Option<String>,
        reply: Sender<Result<DeviceState, String>>,
    },
    StartRecording {
        takes_dir: PathBuf,
        reply: Sender<Result<TakeInfo, String>>,
    },
    StopRecording {
        reply: Sender<Result<TakeInfo, String>>,
    },
    IsRecording {
        reply: Sender<bool>,
    },
    Shutdown,
}

pub struct AudioController {
    tx: Sender<AudioCmd>,
}

impl AudioController {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = unbounded::<AudioCmd>();
        thread::spawn(move || run_worker(app, rx));
        Self { tx }
    }

    pub fn set_device(&self, name: Option<String>) -> Result<DeviceState, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.tx
            .send(AudioCmd::SetDevice {
                name,
                reply: reply_tx,
            })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }

    pub fn start_recording(&self, takes_dir: PathBuf) -> Result<TakeInfo, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.tx
            .send(AudioCmd::StartRecording {
                takes_dir,
                reply: reply_tx,
            })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }

    pub fn stop_recording(&self) -> Result<TakeInfo, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.tx
            .send(AudioCmd::StopRecording { reply: reply_tx })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }

    pub fn is_recording(&self) -> bool {
        let (reply_tx, reply_rx) = bounded(1);
        if self
            .tx
            .send(AudioCmd::IsRecording { reply: reply_tx })
            .is_err()
        {
            return false;
        }
        reply_rx.recv().unwrap_or(false)
    }
}

impl Drop for AudioController {
    fn drop(&mut self) {
        let _ = self.tx.send(AudioCmd::Shutdown);
    }
}

struct WorkerState {
    app: AppHandle,
    current_device_name: Option<String>,
    current_format: Option<(SampleFormat, u32, u16)>,
    stream: Option<Stream>,
    consumer_handle: Option<JoinHandle<()>>,
    writer_slot: WriterSlot,
}

fn run_worker(app: AppHandle, rx: Receiver<AudioCmd>) {
    let mut state = WorkerState {
        app,
        current_device_name: None,
        current_format: None,
        stream: None,
        consumer_handle: None,
        writer_slot: Arc::new(Mutex::new(None)),
    };

    for cmd in rx.iter() {
        match cmd {
            AudioCmd::SetDevice { name, reply } => {
                let result = state.set_device(name);
                let _ = reply.send(result);
            }
            AudioCmd::StartRecording { takes_dir, reply } => {
                let result = state.start_recording(takes_dir);
                let _ = reply.send(result);
            }
            AudioCmd::StopRecording { reply } => {
                let result = state.stop_recording();
                let _ = reply.send(result);
            }
            AudioCmd::IsRecording { reply } => {
                let recording = state.writer_slot.lock().is_some();
                let _ = reply.send(recording);
            }
            AudioCmd::Shutdown => break,
        }
    }
    state.teardown_stream();
}

impl WorkerState {
    fn set_device(&mut self, name: Option<String>) -> Result<DeviceState, String> {
        if self.writer_slot.lock().is_some() {
            return Err("can't change input device while recording".to_string());
        }
        self.teardown_stream();

        let host = cpal::default_host();
        let device = match &name {
            Some(n) => host
                .input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().map(|x| &x == n).unwrap_or(false))
                .ok_or_else(|| format!("input device not found: {}", n))?,
            None => host
                .default_input_device()
                .ok_or_else(|| "no default input device".to_string())?,
        };
        let device_name = device.name().unwrap_or_else(|_| "unknown".to_string());
        let config = device.default_input_config().map_err(|e| e.to_string())?;
        let sample_format = config.sample_format();
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        let stream_config: cpal::StreamConfig = config.clone().into();

        let (sample_tx, sample_rx) = bounded::<Sample>(2048);
        let stream = build_stream(&device, &stream_config, sample_format, sample_tx)
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;

        let app = self.app.clone();
        let writer_slot = self.writer_slot.clone();
        let consumer = thread::spawn(move || {
            consumer_loop(app, sample_rx, writer_slot, channels, sample_rate);
        });

        self.stream = Some(stream);
        self.consumer_handle = Some(consumer);
        self.current_device_name = Some(device_name.clone());
        self.current_format = Some((sample_format, sample_rate, channels));

        Ok(DeviceState {
            name: device_name,
            channels,
            sample_rate,
        })
    }

    fn teardown_stream(&mut self) {
        if let Some(stream) = self.stream.take() {
            let _ = stream.pause();
            drop(stream);
        }
        if let Some(handle) = self.consumer_handle.take() {
            let _ = handle.join();
        }
        self.current_format = None;
        // Note: we do NOT clear current_device_name — we want to remember it
        // even if we later try to restart on the same device.
    }

    fn start_recording(&mut self, takes_dir: PathBuf) -> Result<TakeInfo, String> {
        if self.stream.is_none() {
            return Err(
                "no input device is active — pick one and try again".to_string(),
            );
        }
        if self.writer_slot.lock().is_some() {
            return Err("already recording".to_string());
        }
        let (sample_format, sample_rate, channels) = self
            .current_format
            .ok_or_else(|| "no active stream".to_string())?;

        create_dir_all(&takes_dir).map_err(|e| e.to_string())?;
        let started_at = chrono::Local::now();
        let filename = format!("sesh-{}.wav", started_at.format("%Y%m%d-%H%M%S"));
        let path = takes_dir.join(&filename);

        let wav_format = if matches!(sample_format, SampleFormat::F32) {
            WavFormat::Float
        } else {
            WavFormat::Int
        };
        let bits_per_sample: u16 = match sample_format {
            SampleFormat::F32 => 32,
            SampleFormat::I32 => 32,
            SampleFormat::I16 | SampleFormat::U16 => 16,
            other => return Err(format!("unsupported sample format: {:?}", other)),
        };
        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample,
            sample_format: wav_format,
        };
        let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        let buf = BufWriter::new(file);
        let writer = WavWriter::new(buf, spec).map_err(|e| e.to_string())?;

        let active = ActiveWriter {
            writer,
            path: path.clone(),
            sample_rate,
            channels,
            frames_written: 0,
            started_at,
        };
        *self.writer_slot.lock() = Some(active);

        Ok(TakeInfo {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            sample_rate,
            channels,
            duration_seconds: 0.0,
            started_at: started_at.to_rfc3339(),
        })
    }

    fn stop_recording(&mut self) -> Result<TakeInfo, String> {
        let active = self
            .writer_slot
            .lock()
            .take()
            .ok_or_else(|| "not recording".to_string())?;
        active.finalize().map_err(|e| e.to_string())
    }
}

fn consumer_loop(
    app: AppHandle,
    sample_rx: Receiver<Sample>,
    writer_slot: WriterSlot,
    channels: u16,
    _sample_rate: u32,
) {
    let mut last_meter = Instant::now();
    let mut window_peak: f32 = 0.0;
    let mut window_sumsq: f64 = 0.0;
    let mut window_samples: u64 = 0;
    let mut window_clipped = false;

    for sample in sample_rx.iter() {
        let (peak, sumsq, count, clipped) = sample.analyze();
        if peak > window_peak {
            window_peak = peak;
        }
        window_sumsq += sumsq;
        window_samples += count as u64;
        if clipped {
            window_clipped = true;
        }

        // write if recording
        {
            let mut guard = writer_slot.lock();
            if let Some(active) = guard.as_mut() {
                if let Err(e) = sample.write_to(&mut active.writer) {
                    eprintln!("write error: {}", e);
                } else {
                    active.frames_written += (count as u64) / (channels as u64).max(1);
                }
            }
        }

        if last_meter.elapsed().as_millis() >= 50 {
            let rms = if window_samples > 0 {
                ((window_sumsq / window_samples as f64) as f32).sqrt()
            } else {
                0.0
            };
            let reading = MeterReading {
                peak_db: to_db(window_peak),
                rms_db: to_db(rms),
                clipped: window_clipped,
            };
            let _ = app.emit("sesh:meter", reading);
            window_peak = 0.0;
            window_sumsq = 0.0;
            window_samples = 0;
            window_clipped = false;
            last_meter = Instant::now();
        }
    }
}

fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: SampleFormat,
    tx: Sender<Sample>,
) -> Result<Stream> {
    let err_fn = |err| eprintln!("cpal stream error: {}", err);
    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _| {
                let _ = tx.try_send(Sample::F32(data.to_vec()));
            },
            err_fn,
            None,
        )?,
        SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], _| {
                let _ = tx.try_send(Sample::I16(data.to_vec()));
            },
            err_fn,
            None,
        )?,
        SampleFormat::U16 => device.build_input_stream(
            config,
            move |data: &[u16], _| {
                let _ = tx.try_send(Sample::U16(data.to_vec()));
            },
            err_fn,
            None,
        )?,
        SampleFormat::I32 => device.build_input_stream(
            config,
            move |data: &[i32], _| {
                let _ = tx.try_send(Sample::I32(data.to_vec()));
            },
            err_fn,
            None,
        )?,
        other => return Err(anyhow!("unsupported sample format: {:?}", other)),
    };
    Ok(stream)
}

pub fn list_input_devices() -> Result<Vec<InputDevice>> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let mut out = Vec::new();
    for device in host.input_devices()? {
        let name = device.name().unwrap_or_else(|_| "unknown".to_string());
        let is_default = default_name.as_deref() == Some(name.as_str());
        let (channels, sample_rate) = match device.default_input_config() {
            Ok(c) => (c.channels(), c.sample_rate().0),
            Err(_) => (0, 0),
        };
        out.push(InputDevice {
            name,
            is_default,
            channels,
            sample_rate,
        });
    }
    out.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));
    Ok(out)
}

pub fn default_takes_dir() -> PathBuf {
    let base = dirs::audio_dir()
        .or_else(dirs::document_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("sesh")
}
