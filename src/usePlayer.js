// Playback state for the step slider. Resets when resetKey changes (a new trace).
import { useState, useEffect, useCallback } from 'react';

export function usePlayer(len, resetKey) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => { setI(0); setPlaying(false); }, [len, resetKey]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, Math.max(0, len - 1))), 700 / speed);
    return () => clearInterval(t);
  }, [playing, speed, len]);
  useEffect(() => { if (playing && i >= len - 1) setPlaying(false); }, [i, playing, len]);
  const go = useCallback((n) => {
    setPlaying(false);
    setI(Math.max(0, Math.min(len - 1, n)));
  }, [len]);
  const toggle = () => {
    if (!playing && i >= len - 1) setI(0);
    setPlaying((p) => !p);
  };
  return { i, go, playing, toggle, speed, setSpeed };
}
