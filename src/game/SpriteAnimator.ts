/** Frame count from measured sheet width — never hard-coded per sheet. */
export const frameCount = (sheetWidth: number, frameWidth: number) => Math.max(1, Math.floor(sheetWidth / frameWidth))
export const loopFrame = (timeSec: number, fps: number, frames: number, phase = 0) => Math.floor((timeSec + phase) * fps) % frames
export const holdFrame = (t01: number, frames: number) => Math.min(frames - 1, Math.max(0, Math.floor(t01 * frames)))
