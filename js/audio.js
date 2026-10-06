/* =============================================================
   audio.js — 用 WebAudio 实时合成音效（不依赖任何音频文件）
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  let ctx = null;
  let muted = false;

  function ac() {
    if (muted) return null;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) {
      try { ctx = new Ctor(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    return ctx;
  }

  /** 一段带包络的振荡音 */
  function tone(freq, dur, type, gain, delay, slideTo) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain == null ? 0.16 : gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** 白噪声（用于落地「叮」的质感） */
  function noise(dur, gain, delay) {
    const c = ac();
    if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    const amp = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    amp.gain.value = gain == null ? 0.1 : gain;
    src.buffer = buf;
    src.connect(filter).connect(amp).connect(c.destination);
    src.start(c.currentTime + (delay || 0));
  }

  const sounds = {
    /** 抛起 */
    toss() { tone(520, 0.16, 'triangle', 0.1, 0, 1150); },
    /** 空中旋转的轻微空气声 */
    spin() { noise(0.35, 0.035, 0.02); },
    /** 落定 */
    land(face) {
      noise(0.16, 0.16, 0);
      tone(face === 'tails' ? 420 : 660, 0.5, 'sine', 0.14, 0.02);
      tone(face === 'tails' ? 630 : 990, 0.4, 'sine', 0.06, 0.06);
    },
    /** 掷骰子：出手时骰子在手里/桌上碰撞的沙沙声 */
    shake() {
      noise(0.22, 0.05, 0);
      noise(0.14, 0.035, 0.09);
    },
    /** 单颗骰子落定：短促的硬质碰撞（比硬币更「木」一点） */
    dice() {
      noise(0.07, 0.12, 0);
      tone(300, 0.12, 'triangle', 0.07, 0.005, 170);
    },
    /** 全部落定、点数和揭晓 */
    sum() {
      tone(760, 0.34, 'sine', 0.08, 0);
      tone(1140, 0.26, 'sine', 0.035, 0.05);
    }
  };

  App.audio = {
    setMuted(v) { muted = !!v; },
    isMuted() { return muted; },
    play(name, arg) {
      const fn = sounds[name];
      if (!fn || muted) return;
      try { fn(arg); } catch (e) { /* 忽略音频异常，不影响功能 */ }
    },
    /** 首次交互时解锁音频上下文 */
    unlock() { ac(); }
  };
})(window);
