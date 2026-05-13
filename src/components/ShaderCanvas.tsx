import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle, Vec2 } from "ogl";

const vertex = /* glsl */ `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

type Props = {
  source: string;
  active?: boolean;
};

export function ShaderCanvas({ source, active = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    const renderer = new Renderer({
      canvas,
      webgl: 1,
      dpr: Math.min(window.devicePixelRatio, 2),
      alpha: false,
      antialias: false,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 1);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment: source,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(1, 1) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    const setSize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight);
      program.uniforms.uResolution.value.set(
        gl.canvas.width,
        gl.canvas.height,
      );
    };
    setSize();

    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(container);

    let raf = 0;
    let start = performance.now();
    let lastFrame = start;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!activeRef.current) {
        start += now - lastFrame;
        lastFrame = now;
        return;
      }
      lastFrame = now;
      program.uniforms.uTime.value = (now - start) / 1000;
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
      canvas.remove();
    };
  }, [source]);

  return (
    <div
      ref={containerRef}
      className="shader-layer"
      aria-hidden
    />
  );
}
