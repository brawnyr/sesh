import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Tauri injects globals into window. When running Vite-only (browser dev),
// those globals are absent and invoke() throws. Detect once and stub out
// commands so the UI loads cleanly without recording features.
const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri) return Promise.reject(new Error("tauri shell not running"));
  return invoke<T>(cmd, args);
}

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

const STUB_SETTINGS: Settings = {
  takes_dir: "C:\\Users\\brawny\\sample library\\sesh",
};

export const seshApi = {
  listInputDevices: () =>
    hasTauri
      ? call<InputDevice[]>("list_input_devices")
      : Promise.resolve<InputDevice[]>([]),
  getSettings: () =>
    hasTauri ? call<Settings>("get_settings") : Promise.resolve(STUB_SETTINGS),
  setTakesDir: (dir: string) =>
    hasTauri
      ? call<Settings>("set_takes_dir", { dir })
      : Promise.resolve<Settings>({ takes_dir: dir }),
  setInputDevice: (deviceName: string | null) =>
    hasTauri
      ? call<DeviceState>("set_input_device", { deviceName })
      : Promise.resolve<DeviceState>({
          name: deviceName ?? "",
          channels: 2,
          sample_rate: 48000,
        }),
  startRecording: () => call<TakeInfo>("start_recording"),
  stopRecording: () => call<TakeInfo>("stop_recording"),
  isRecording: () =>
    hasTauri ? call<boolean>("is_recording") : Promise.resolve(false),
  listTakes: () =>
    hasTauri ? call<TakeMeta[]>("list_takes") : Promise.resolve<TakeMeta[]>([]),
  revealInFolder: (path: string) =>
    hasTauri ? call<void>("reveal_in_folder", { path }) : Promise.resolve(),
};

export type MeterReading = {
  peak_db: number;
  rms_db: number;
  clipped: boolean;
};

export function onMeter(
  fn: (reading: MeterReading) => void,
): Promise<UnlistenFn> {
  if (!hasTauri) return Promise.resolve(() => {});
  return listen<MeterReading>("sesh:meter", (e) => fn(e.payload));
}
