export type SplashEvent = {
  id: number;
  x: number;
  y: number;
};

type Props = {
  splash: SplashEvent | null;
};

export function Splash(_: Props) {
  return null;
}
