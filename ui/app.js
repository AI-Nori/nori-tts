/* ============================================================
   nori-tts WebUI — 交互逻辑
   ============================================================ */

// ── 全局状态 ──────────────────────────────────
let voicesList = [];
let currentUploadBase64 = '';
let currentUploadName = '';
let currentUploadDuration = null;
let cloneAudioCtx = null;
let cloneAnalyser = null;
let cloneSourceNode = null;
let presetAudioCtx = null;
let presetAnalyser = null;
let presetSourceNode = null;

// ── 初始化 ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadVoices();

  // 拖拽上传
  const uploadArea = document.getElementById('fileUploadArea');
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = '#F5A623'; });
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
});

// ── Toast ─────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = (type === 'success' ? '✓ ' : '✗ ') + msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── 音色列表 ──────────────────────────────────
async function loadVoices() {
  try {
    const resp = await fetch('/ui/api/voices');
    const data = await resp.json();
    voicesList = data.voices || [];

    const select = document.getElementById('voiceSelect');
    const prev = select.value;
    select.innerHTML = '';

    if (voicesList.length === 0) {
      select.innerHTML = '<option value="">暂无预制音色</option>';
      return;
    }

    voicesList.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voice_id;
      opt.textContent = v.voice_id;
      select.appendChild(opt);
    });

    // 恢复之前的选择
    if (prev && voicesList.some(v => v.voice_id === prev)) {
      select.value = prev;
    }

    updateRefText();
    select.addEventListener('change', updateRefText);
  } catch (e) {
    showToast('加载音色列表失败', 'error');
  }
}

function updateRefText() {
  const select = document.getElementById('voiceSelect');
  const refDiv = document.getElementById('voiceRefText');
  const voice = voicesList.find(v => v.voice_id === select.value);
  if (voice && voice.ref_text) {
    refDiv.textContent = `"${voice.ref_text}"`;
  } else {
    refDiv.textContent = '';
  }
}

// ── 文件上传 ──────────────────────────────────
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (file) handleFile(file);
}

function handleFile(file) {
  const validExts = ['.wav', '.mp3', '.ogg'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!validExts.includes(ext)) {
    showToast('仅支持 wav/mp3/ogg 格式', 'error');
    return;
  }

  // 文件大小校验
  if (file.size < 44) {
    showToast('音频文件过小，可能不是有效的音频文件', 'error');
    return;
  }
  if (file.size < 1024) {
    showToast('音频文件异常小（<1KB），请确认文件有效', 'error');
    return;
  }

  currentUploadName = file.name;

  const reader = new FileReader();
  reader.onload = () => {
    currentUploadBase64 = reader.result; // data:xxx;base64,...
    const area = document.getElementById('fileUploadArea');
    area.classList.add('has-file');
    document.getElementById('uploadText').innerHTML =
      `<div class="file-info">📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>`;

    // 获取音频时长
    const audio = new Audio(reader.result);
    currentUploadDuration = null;
    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      if (isFinite(dur)) {
        currentUploadDuration = dur;
        document.getElementById('uploadText').innerHTML +=
          `<div class="file-info">⏱ ${dur.toFixed(1)}s</div>`;
        if (dur < 0.1) {
          showToast('音频时长过短（<0.1秒），可能无效', 'error');
        }
      }
    });
    audio.addEventListener('error', () => {
      currentUploadDuration = null;
      showToast('无法解码音频文件，请确认文件有效', 'error');
    });

    // 启用"添加到预制"按钮
    document.getElementById('addVoiceBtn').disabled = false;
  };
  reader.readAsDataURL(file);
}

// ── 合成：预制音色 ───────────────────────────
async function synthesizePreset() {
  const voice = document.getElementById('voiceSelect').value;
  const text = document.getElementById('presetText').value.trim();

  if (!voice) { showToast('请选择音色', 'error'); return; }
  if (!text) { showToast('请输入合成文本', 'error'); return; }

  const btn = document.getElementById('presetSynthBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="paw-spinner">🐾</span> 合成中...';

  try {
    const resp = await fetch('/ui/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice, text }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '合成失败' }));
      throw new Error(err.error || '合成失败');
    }

    const blob = await resp.blob();
    const filename = resp.headers.get('X-Audio-Filename') || 'audio.wav';
    renderAudioPlayer('presetPlayer', blob, filename, 'preset');
    showToast('合成完成！');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎵 合成';
  }
}

// ── 合成：声音克隆 ───────────────────────────
async function synthesizeClone() {
  const refText = document.getElementById('cloneRefText').value.trim();
  const text = document.getElementById('cloneText').value.trim();

  if (!currentUploadBase64) { showToast('请上传参考音频', 'error'); return; }
  if (!refText) { showToast('请输入参考文本', 'error'); return; }
  if (!text) { showToast('请输入合成文本', 'error'); return; }

  // 校验已上传音频的有效时长
  if (currentUploadDuration != null && currentUploadDuration < 0.1) {
    showToast('参考音频时长过短（至少0.1秒），请重新上传', 'error');
    return;
  }

  const btn = document.getElementById('cloneSynthBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="paw-spinner">🐾</span> 合成中...';

  try {
    const resp = await fetch('/ui/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref_audio: currentUploadBase64,
        ref_text: refText,
        text,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '合成失败' }));
      throw new Error(err.error || '合成失败');
    }

    const blob = await resp.blob();
    const filename = resp.headers.get('X-Audio-Filename') || 'audio.wav';
    renderAudioPlayer('clonePlayer', blob, filename, 'clone');
    showToast('合成完成！');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎵 合成';
  }
}

// ── 音频播放器 + 波形可视化 ───────────────────
function renderAudioPlayer(containerId, blob, filename, type) {
  const container = document.getElementById(containerId);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const audioId = type + 'Audio';

  window[audioId] = audio;

  container.innerHTML = '';
  container.className = 'audio-player';

  // Canvas 波形
  const canvas = document.createElement('canvas');
  canvas.id = type + 'Canvas';
  container.appendChild(canvas);

  // 控制栏
  const controls = document.createElement('div');
  controls.className = 'audio-controls';

  const playBtn = document.createElement('button');
  playBtn.innerHTML = '▶';
  playBtn.onclick = () => togglePlay(audio, playBtn, type);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'audio-time';
  timeSpan.textContent = '0:00 / 0:00';

  controls.appendChild(playBtn);
  controls.appendChild(timeSpan);
  container.appendChild(controls);

  const filenameDiv = document.createElement('div');
  filenameDiv.className = 'audio-filename';
  filenameDiv.textContent = `💾 ${filename}`;
  container.appendChild(filenameDiv);

  // 时间更新
  audio.addEventListener('timeupdate', () => {
    timeSpan.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
  });
  audio.addEventListener('ended', () => {
    playBtn.innerHTML = '▶';
  });

  // 设置 Canvas + Web Audio API
  setupCanvas(canvas, audio, type);
}

function togglePlay(audio, btn, type) {
  if (audio.paused) {
    // 停掉另一个播放器
    const otherType = type === 'preset' ? 'clone' : 'preset';
    const otherAudio = window[otherType + 'Audio'];
    if (otherAudio && !otherAudio.paused) {
      otherAudio.pause();
      const otherBtn = otherAudio._playBtn;
      if (otherBtn) otherBtn.innerHTML = '▶';
    }

    audio.play();
    btn.innerHTML = '⏸';
    audio._playBtn = btn;
    startVisualization(type);
  } else {
    audio.pause();
    btn.innerHTML = '▶';
  }
}

function formatTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// ── 波形可视化 ────────────────────────────────
function setupCanvas(canvas, audio, type) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 初始化 AudioContext
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  const source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  if (type === 'preset') {
    presetAudioCtx = audioCtx;
    presetAnalyser = analyser;
    presetSourceNode = source;
  } else {
    cloneAudioCtx = audioCtx;
    cloneAnalyser = analyser;
    cloneSourceNode = source;
  }

  // 画空白波形
  drawIdleWave(ctx, rect.width, rect.height);
}

function drawIdleWave(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#D4C5A9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  for (let x = 0; x < w; x++) {
    const y = h / 2 + Math.sin(x * 0.05) * 3;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

let animFrameId = null;
function startVisualization(type) {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  const canvas = document.getElementById(type + 'Canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  const analyser = type === 'preset' ? presetAnalyser : cloneAnalyser;
  if (!analyser) return;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, w, h);

    // 暖色渐变波形
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#F5A623');
    gradient.addColorStop(0.5, '#FF8A65');
    gradient.addColorStop(1, '#FFB74D');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const sliceWidth = w / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  draw();
}

// ── 添加预制音色 ──────────────────────────────
function showAddVoiceModal() {
  if (!currentUploadBase64) {
    showToast('请先上传参考音频', 'error');
    return;
  }
  document.getElementById('addVoiceModal').style.display = 'flex';
  document.getElementById('newVoiceName').value = '';
  document.getElementById('newVoiceName').focus();
}

function closeAddVoiceModal() {
  document.getElementById('addVoiceModal').style.display = 'none';
}

function closeModalOutside(e) {
  if (e.target.id === 'addVoiceModal') closeAddVoiceModal();
}

async function confirmAddVoice() {
  const name = document.getElementById('newVoiceName').value.trim();
  if (!name) { showToast('请输入音色名称', 'error'); return; }
  const refText = document.getElementById('cloneRefText').value.trim();
  if (!refText) { showToast('参考文本不能为空', 'error'); return; }

  const btn = document.getElementById('confirmAddBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="paw-spinner">🐾</span> 提交中...';

  try {
    const resp = await fetch('/ui/api/voices/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_name: name,
        ref_audio: currentUploadBase64,
        ref_text: refText,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '添加失败');

    showToast(`音色 "${name}" 已添加到预制！`);
    closeAddVoiceModal();

    // 刷新音色列表
    await loadVoices();

    // 选中新添加的音色
    document.getElementById('voiceSelect').value = name;
    updateRefText();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '确认添加';
  }
}

// 回车提交模态框
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('addVoiceModal').style.display === 'flex') {
    confirmAddVoice();
  }
  if (e.key === 'Escape') {
    closeAddVoiceModal();
  }
});
