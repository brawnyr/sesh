import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InputDevice = {
  name: string;
  is_default: boolean;
  channels: number;
  sample_rate: number;
};

export type DeviceState = {
  name: string;
  channels: number;
  sample_rate: number;
};

export type TakeInfo = {
  path: string;
  name: string;
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  started_at: string;
};

export type TakeMeta = {
  path: string;
  name: string;
  bytes: number;
  modified_unix: number;
};

export type Settings = {
  takes_dir: string;
};

export const seshApi = {
  listInputDevices: () => invoke<InputDevice[]>("list_input_devices"),
  getSettings: () => invoke<Settings>("get_settings"),
  setTakesDir: (dir: string) => invoke<Settings>("set_takes_dir", { dir }),
  setInputDevice: (deviceName: string | null) =>
    invoke<DeviceState>("set_input_device", { deviceName }),
  startRecording: () => invoke<TakeInfo>("start_recording"),
  stopRecording: () => invoke<TakeInfo>("stop_recording"),
  isRecording: () => invoke<boolean>("is_recording"),
  listTakes: () => invoke<TakeMeta[]>("list_takes"),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
};

export type MeterReading = {
  peak_db: number;
  rms_db: number;
  clipped: boolean;
};

export function onMeter(
  fn: (reading: MeterReading) => void,
): Promise<UnlistenFn> {
  return listen<MeterReading>("sesh:meter", (e) => fn(e.payload));
}
