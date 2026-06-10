/**
 * 图片处理工具 - 抠图功能
 * 纯前端实现，使用 @imgly/background-removal 进行 AI 推理
 */

// ==================== DOM 元素 ====================
const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const uploadArea = document.getElementById('uploadArea');
const progressArea = document.getElementById('progressArea');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const progressDetail = document.getElementById('progressDetail');
const workspace = document.getElementById('workspace');
const sourceCanvas = document.getElementById('sourceCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const brushBtn = document.getElementById('brushBtn');
const eraserBtn = document.getElementById('eraserBtn');
const brushSize = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const brushSoft = document.getElementById('brushSoft');
const brushSoftValue = document.getElementById('brushSoftValue');
const undoBtn = document.getElementById('undoBtn');
const toggleMaskBtn = document.getElementById('toggleMaskBtn');
const maskIndicator = document.getElementById('maskIndicator');
const reuploadBtn = document.getElementById('reuploadBtn');
const downloadBtn = document.getElementById('downloadBtn');

const sourceCtx = sourceCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');
const maskCtx = maskCanvas.getContext('2d');

// ==================== 状态变量 ====================
let removeBackgroundFn = null;
let originalImage = null;
let originalImageData = null;
let maskImageData = null;
let isDrawing = false;
let currentTool = 'brush'; // 'brush' | 'eraser'
let undoStack = [];
let showMask = false;
let lastX = 0, lastY = 0;

const MAX_UNDO = 20;
const LIB_CDN = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5';

// ==================== 上传功能 ====================

uploadBox.addEventListener('click', () => fileInput.click());

uploadBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => {
  uploadBox.classList.remove('dragover');
});

uploadBox.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadBox.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('图片大小不能超过 10MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      setupCanvases(img);
      startProcessing(file);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvases(img) {
  const maxWidth = 800;
  const maxHeight = 600;
  let w = img.width;
  let h = img.height;

  if (w > maxWidth || h > maxHeight) {
    const ratio = Math.min(maxWidth / w, maxHeight / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  sourceCanvas.width = w;
  sourceCanvas.height = h;
  resultCanvas.width = w;
  resultCanvas.height = h;
  maskCanvas.width = w;
  maskCanvas.height = h;

  sourceCtx.drawImage(img, 0, 0, w, h);
  originalImageData = sourceCtx.getImageData(0, 0, w, h);
}

// ==================== AI 处理 ====================

async function startProcessing(file) {
  uploadArea.classList.add('hidden');
  progressArea.classList.remove('hidden');

  try {
    if (!removeBackgroundFn) {
      progressText.textContent = '正在加载 AI 模型...';
      progressFill.style.width = '10%';

      const module = await import(LIB_CDN + '/+esm');
      removeBackgroundFn = module.removeBackground;
    }

    progressText.textContent = '正在分析图片...';
    progressFill.style.width = '50%';
    progressDetail.textContent = 'AI 正在识别前景与背景';

    const blob = await fileToBlob(file);
    const resultBlob = await removeBackgroundFn(blob, {
      model: 'medium',
      output: {
        format: 'image/png',
        quality: 0.9
      },
      progress: (key, current, total) => {
        const pct = Math.round((current / total) * 40) + 50;
        progressFill.style.width = pct + '%';
      }
    });

    progressFill.style.width = '100%';
    progressText.textContent = '处理完成！';

    await displayResult(resultBlob);

    progressArea.classList.add('hidden');
    workspace.classList.remove('hidden');

  } catch (err) {
    console.error(err);
    progressText.textContent = '处理失败';
    progressDetail.textContent = '请刷新页面重试，或尝试其他图片';
    setTimeout(() => {
      progressArea.classList.add('hidden');
      uploadArea.classList.remove('hidden');
    }, 3000);
  }
}

function fileToBlob(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const arr = new Uint8Array(reader.result);
      resolve(new Blob([arr], { type: file.type }));
    };
    reader.readAsArrayBuffer(file);
  });
}

async function displayResult(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = url; });

  resultCtx.drawImage(img, 0, 0, resultCanvas.width, resultCanvas.height);

  // 提取 mask
  const resultData = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
  maskImageData = maskCtx.createImageData(resultCanvas.width, resultCanvas.height);

  for (let i = 0; i < resultData.data.length; i += 4) {
    const alpha = resultData.data[i + 3];
    maskImageData.data[i] = alpha;
    maskImageData.data[i + 1] = alpha;
    maskImageData.data[i + 2] = alpha;
    maskImageData.data[i + 3] = 255;
  }

  maskCtx.putImageData(maskImageData, 0, 0);
  undoStack = [];
  pushUndo();

  URL.revokeObjectURL(url);
}

// ==================== 画笔编辑 ====================

function getCanvasCoords(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startDraw(e) {
  e.preventDefault();
  isDrawing = true;
  const coords = getCanvasCoords(e, maskCanvas);
  lastX = coords.x;
  lastY = coords.y;
  pushUndo();
  draw(e);
}

function draw(e) {
  if (!isDrawing) return;
  e.preventDefault();

  const coords = getCanvasCoords(e, maskCanvas);
  const size = parseInt(brushSize.value);
  const soft = parseInt(brushSoft.value) / 100;

  maskCtx.save();
  maskCtx.lineCap = 'round';
  maskCtx.lineJoin = 'round';
  maskCtx.lineWidth = size;

  if (soft > 0) {
    maskCtx.filter = `blur(${Math.round(size * soft * 0.3)}px)`;
  }

  if (currentTool === 'brush') {
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.strokeStyle = '#FFFFFF';
  } else {
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.strokeStyle = '#000000';
  }

  maskCtx.beginPath();
  maskCtx.moveTo(lastX, lastY);
  maskCtx.lineTo(coords.x, coords.y);
  maskCtx.stroke();
  maskCtx.restore();

  lastX = coords.x;
  lastY = coords.y;

  applyMask();
}

function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;
}

function applyMask() {
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const outData = resultCtx.createImageData(resultCanvas.width, resultCanvas.height);

  for (let i = 0; i < maskData.data.length; i += 4) {
    const alpha = maskData.data[i];
    outData.data[i] = originalImageData.data[i];
    outData.data[i + 1] = originalImageData.data[i + 1];
    outData.data[i + 2] = originalImageData.data[i + 2];
    outData.data[i + 3] = alpha;
  }

  resultCtx.putImageData(outData, 0, 0);
}

// 绑定画笔事件
maskCanvas.addEventListener('mousedown', startDraw);
maskCanvas.addEventListener('mousemove', draw);
maskCanvas.addEventListener('mouseup', endDraw);
maskCanvas.addEventListener('mouseleave', endDraw);

maskCanvas.addEventListener('touchstart', startDraw, { passive: false });
maskCanvas.addEventListener('touchmove', draw, { passive: false });
maskCanvas.addEventListener('touchend', endDraw);

// ==================== 工具切换 ====================

brushBtn.addEventListener('click', () => {
  currentTool = 'brush';
  brushBtn.classList.add('active');
  eraserBtn.classList.remove('active');
});

eraserBtn.addEventListener('click', () => {
  currentTool = 'eraser';
  eraserBtn.classList.add('active');
  brushBtn.classList.remove('active');
});

brushSize.addEventListener('input', () => {
  brushSizeValue.textContent = brushSize.value + 'px';
});

brushSoft.addEventListener('input', () => {
  brushSoftValue.textContent = brushSoft.value + '%';
});

// ==================== 撤销功能 ====================

function pushUndo() {
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  undoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
  updateUndoBtn();
}

function undo() {
  if (undoStack.length <= 1) return;
  undoStack.pop();
  const data = undoStack[undoStack.length - 1];
  maskCtx.putImageData(data, 0, 0);
  applyMask();
  updateUndoBtn();
}

function updateUndoBtn() {
  undoBtn.disabled = undoStack.length <= 1;
}

undoBtn.addEventListener('click', undo);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
  }
});

// ==================== 遮罩显示切换 ====================

toggleMaskBtn.addEventListener('click', () => {
  showMask = !showMask;
  if (showMask) {
    maskCanvas.classList.remove('hidden');
    resultCanvas.classList.add('hidden');
    maskIndicator.classList.remove('hidden');
    toggleMaskBtn.classList.add('active');
  } else {
    maskCanvas.classList.add('hidden');
    resultCanvas.classList.remove('hidden');
    maskIndicator.classList.add('hidden');
    toggleMaskBtn.classList.remove('active');
  }
});

// ==================== 重新上传 ====================

reuploadBtn.addEventListener('click', () => {
  workspace.classList.add('hidden');
  uploadArea.classList.remove('hidden');
  fileInput.value = '';
  undoStack = [];
  showMask = false;
  maskCanvas.classList.add('hidden');
  resultCanvas.classList.remove('hidden');
  maskIndicator.classList.add('hidden');
  toggleMaskBtn.classList.remove('active');
});

// ==================== 下载功能 ====================

downloadBtn.addEventListener('click', () => {
  resultCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `removed-bg-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});
