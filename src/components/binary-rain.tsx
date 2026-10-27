"use client";

import { useEffect, useRef } from "react";

const CELL = 16;
const FRAME_MS = 70;

/** Faint falling 0/1 columns behind the dashboard. Off when the OS asks for reduced motion or the window is hidden. */
export function BinaryRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let drops: number[] = [];
    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      drops = Array.from({ length: Math.ceil(canvas!.width / CELL) }, () => Math.floor(Math.random() * -50));
      ctx!.fillStyle = "#000";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
    }
    resize();
    window.addEventListener("resize", resize);

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff41";
      ctx.font = `${CELL - 2}px monospace`;
      drops.forEach((row, column) => {
        if (row >= 0) ctx.fillText(Math.random() < 0.5 ? "0" : "1", column * CELL, row * CELL);
        drops[column] = row * CELL > canvas.height && Math.random() > 0.975 ? 0 : row + 1;
      });
    }, FRAME_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 opacity-[0.12]" />;
}
