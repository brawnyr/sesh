use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use crossbeam_channel::{bounded, unbounded, Sender};
use hound::{SampleFormat as WavFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::fs::create_dir_all;
use std::io::BufWriter;
use std::path::PathBuf;
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
pub struct TakeInfo {
    pub path: String,
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f32,
    pub started_at: String,
}

enum Sample {
    F32(Vec<f32>),
    I16(Vec<i16>),
    U16(Vec<u16>),
    I32(Vec<i32>),
}

struct ActiveRecording {
    stream: Stream,
    writer_handle: JoinHandle<Result<TakeInfo>>,
}

// Commands sent into the audio worker thread. The worker owns the cpal Stream
// (which isn't Send), so all access happens on that thread.
pub enum AudioCmd {
    Start {
        app: AppHandle,
        device: Option<String>,
        takes_dir: PathBuf,
        reply: Sender<Result<TakeInfo, String>>,
    },
    Stop {
        reply: Sender<Result<TakeInfo, String>>,
    },
    IsRecording {
        reply: Sender<bool>,
    },
}

pub struct AudioController {
    tx: Sender<AudioCmd>,
}

impl AudioController {
    pub fn spawn() -> Self {
        let (tx, rx) = unbounded::<AudioCmd>();
        thread::spawn(move || {
            let mut active: Option<ActiveRecording> = None;
            for cmd in rx.iter() {
                match cmd {
                    AudioCmd::Start {
                        app,
                        device,
                        takes_dir,
                        reply,
                    } => {
                        if active.is_some() {
                            let _ = reply.send(Err("already recording".to_string()));
                            continue;
                        }
                        match start_recording(app, device, takes_dir) {
                            Ok((recording, info)) => {
                                active = Some(recording);
                                let _ = reply.send(Ok(info));
                            }
                            Err(e) => {
                                let _ = reply.send(Err(e.to_string()));
                            }
                        }
                    }
                    AudioCmd::Stop { reply } => match active.take() {
                        Some(rec) => {
                            let result = stop_recording(rec).map_err(|e| e.to_string());
                            let _ = reply.send(result);
                        }
                        None => {
                            let _ = reply.send(Err("not recording".to_string()));
                        }
                    },
                    AudioCmd::IsRecording { reply } => {
                        let _ = reply.send(active.is_some());
                    }
                }
            }
        });
        Self { tx }
    }

    pub fn start(
        &self,
        app: AppHandle,
        device: Option<String>,
        takes_dir: PathBuf,
    ) -> Result<TakeInfo, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.tx
            .send(AudioCmd::Start {
                app,
                device,
                takes_dir,
                reply: reply_tx,
            })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }

    pub fn stop(&self) -> Result<TakeInfo, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.tx
            .send(AudioCmd::Stop { reply: reply_tx })
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

fn start_recording(
    app: AppHandle,
    device_name: Option<String>,
    takes_dir: PathBuf,
) -> Result<(ActiveRecording, TakeInfo)> {
    create_dir_all(&takes_dir)?;

    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            .ok_or_else(|| anyhow!("input device not found: {}", name))?,
        None => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device"))?,
    };
    let config = device.default_input_config()?;
    let sample_format = config.sample_format();
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let stream_config: cpal::StreamConfig = config.clone().into();

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
        other => return Err(anyhow!("unsupported sample format: {:?}", other)),
    };
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample,
        sample_format: wav_format,
    };

    let (sample_tx, sample_rx) = bounded::<Sample>(2048);

    let writer_app = app.clone();
    let writer_path = path.clone();
    let started_iso = started_at.to_rfc3339();
    let writer_handle = thread::spawn(move || -> Result<TakeInfo> {
        let file = std::fs::File::create(&writer_path)?;
        let buf = BufWriter::new(file);
        let mut writer = WavWriter::new(buf, spec)?;
        let mut frames_written: u64 = 0;
        let mut last_meter = Instant::now();
        let mut window_peak: f32 = 0.0;
        for sample in sample_rx.iter() {
            let (count, peak) = write_samples(&mut writer, sample)?;
            frames_written += (count as u64) / (channels as u64).max(1);
            if peak > window_peak {
                window_peak = peak;
            }
            if last_meter.elapsed().as_millis() >= 50 {
                let _ = writer_app.emit("sesh:meter", window_peak);
                window_peak = 0.0;
                last_meter = Instant::now();
            }
        }
        writer.finalize()?;
        let duration = frames_written as f32 / sample_rate as f32;
        let name = writer_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(TakeInfo {
            path: writer_path.to_string_lossy().to_string(),
            name,
            sample_rate,
            channels,
            duration_seconds: duration,
            started_at: started_iso,
        })
    });

    let stream = build_stream(&device, &stream_config, sample_format, sample_tx)?;
    stream.play()?;

    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let info = TakeInfo {
        path: path.to_string_lossy().to_string(),
        name,
        sample_rate,
        channels,
        duration_seconds: 0.0,
        started_at: started_at.to_rfc3339(),
    };
    Ok((
        ActiveRecording {
            stream,
            writer_handle,
        },
        info,
    ))
}

fn stop_recording(active: ActiveRecording) -> Result<TakeInfo> {
    let _ = active.stream.pause();
    drop(active.stream);
    active
        .writer_handle
        .join()
        .map_err(|_| anyhow!("writer thread panicked"))?
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

fn write_samples<W: std::io::Write + std::io::Seek>(
    writer: &mut WavWriter<W>,
    sample: Sample,
) -> Result<(usize, f32)> {
    let mut peak: f32 = 0.0;
    match sample {
        Sample::F32(buf) => {
            let len = buf.len();
            for s in &buf {
                let a = s.abs();
                if a > peak {
                    peak = a;
                }
                writer.write_sample(*s)?;
            }
            Ok((len, peak))
        }
        Sample::I16(buf) => {
            let len = buf.len();
            for s in &buf {
                let a = (*s as f32 / i16::MAX as f32).abs();
                if a > peak {
                    peak = a;
                }
                writer.write_sample(*s)?;
            }
            Ok((len, peak))
        }
        Sample::U16(buf) => {
            let len = buf.len();
            for s in &buf {
                let centered = *s as i32 - i16::MAX as i32 - 1;
                let signed = centered.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                let a = (signed as f32 / i16::MAX as f32).abs();
                if a > peak {
                    peak = a;
                }
                writer.write_sample(signed)?;
            }
            Ok((len, peak))
        }
        Sample::I32(buf) => {
            let len = buf.len();
            for s in &buf {
                let a = (*s as f32 / i32::MAX as f32).abs();
                if a > peak {
                    peak = a;
                }
                writer.write_sample(*s)?;
            }
            Ok((len, peak))
        }
    }
}
