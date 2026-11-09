/** Tiny synthesised sound effects (WebAudio, no assets). The sim only queues `{ name, x, y }` requests; this plays the nearby ones. */
export type SfxName = 'hit' | 'arrow' | 'capture' | 'boom' | 'cannon' | 'build'

export class Sfx {
  muted = false
  private ctx: AudioContext | null = null
  private last: Partial<Record<SfxName, number>> = {}
  private noiseBuf: AudioBuffer | null = null

  /** Browsers only allow audio after a user gesture: call this from a pointer/key handler. */
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch { /* no audio available */ }
  }
  toggleMute() { this.muted = !this.muted; return this.muted }

  private noise() {
    const c = this.ctx!
    if (!this.noiseBuf) {
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    return this.noiseBuf
  }
  private burst(vol: number, dur: number, type: BiquadFilterType, freq: number, q = 1, sweepTo?: number) {
    const c = this.ctx!, t = c.currentTime
    const src = c.createBufferSource(); src.buffer = this.noise()
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); f.Q.value = q
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f).connect(g).connect(c.destination); src.start(t, Math.random() * 0.5, dur + 0.05)
  }
  private tone(vol: number, dur: number, from: number, to: number, wave: OscillatorType = 'sine', delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay
    const o = c.createOscillator(); o.type = wave; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur)
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05)
  }

  play(name: SfxName, vol = 0.5) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running' || vol <= 0.02) return
    const now = performance.now(), gap = name === 'hit' ? 70 : name === 'arrow' ? 90 : 120
    if (now - (this.last[name] ?? 0) < gap) return
    this.last[name] = now
    switch (name) {
      case 'hit': this.burst(0.5 * vol, 0.07, 'bandpass', 1100, 1.2); this.tone(0.25 * vol, 0.06, 220, 120, 'square'); break
      case 'arrow': this.burst(0.35 * vol, 0.1, 'highpass', 2500, 0.7, 5000); break
      case 'cannon': this.tone(0.8 * vol, 0.3, 120, 38, 'sine'); this.burst(0.7 * vol, 0.25, 'lowpass', 1400, 0.8, 200); break
      case 'boom': this.burst(0.9 * vol, 0.55, 'lowpass', 700, 0.7, 90); this.tone(0.5 * vol, 0.4, 80, 30, 'sine'); break
      case 'capture': this.tone(0.4 * vol, 0.25, 330, 330, 'triangle'); this.tone(0.4 * vol, 0.3, 440, 440, 'triangle', 0.18); this.tone(0.4 * vol, 0.45, 660, 660, 'triangle', 0.4); this.burst(0.3 * vol, 0.4, 'lowpass', 600, 0.5, 120); break
      case 'build': this.tone(0.3 * vol, 0.08, 500, 380, 'square'); break
    }
  }
}
