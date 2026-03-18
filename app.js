// Invoco Zip Browser - Application Logic

const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const status = document.getElementById('status');
const uploadView = document.getElementById('upload-view');
const viewerView = document.getElementById('viewer-view');
const viewerTitle = document.getElementById('viewer-title');
const viewerFrame = document.getElementById('viewer-frame');
const uploadNewBtn = document.getElementById('upload-new-btn');

// --- Service Worker ---

async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not supported in this browser. Use a modern browser over HTTPS or localhost.');
  }
  const reg = await navigator.serviceWorker.register('./sw.js');

  // Wait for the SW to become active
  const sw = reg.installing || reg.waiting || reg.active;
  if (sw.state === 'activated') return reg;

  return new Promise((resolve, reject) => {
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated') resolve(reg);
    });
    setTimeout(() => reject(new Error('Service Worker activation timed out')), 10000);
  });
}

function sendToSW(type, data) {
  return new Promise((resolve, reject) => {
    const sw = navigator.serviceWorker.controller;
    if (!sw) {
      reject(new Error('Service Worker not active. Try refreshing the page.'));
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    setTimeout(() => reject(new Error('Service Worker did not respond')), 10000);
    sw.postMessage({ type, data }, [channel.port2]);
  });
}

// --- Zip Extraction ---

function stripCommonRoot(paths) {
  if (paths.length === 0) return { prefix: '', stripped: paths };

  // Find common directory prefix
  const parts = paths[0].split('/');
  let prefixParts = 0;

  if (parts.length > 1) {
    const candidate = parts[0] + '/';
    const allMatch = paths.every((p) => p.startsWith(candidate));
    if (allMatch) prefixParts = 1;
  }

  if (prefixParts === 0) return { prefix: '', stripped: paths };

  const prefix = parts.slice(0, prefixParts).join('/') + '/';
  const stripped = paths.map((p) => p.substring(prefix.length));
  return { prefix, stripped };
}

function shouldSkip(path) {
  const lower = path.toLowerCase();
  if (lower.includes('__macosx/')) return true;
  if (lower.endsWith('.ds_store')) return true;
  if (lower.endsWith('/')) return true; // directories
  return false;
}

async function extractZip(file) {
  if (file.size > MAX_ZIP_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 100MB.`);
  }

  const arrayBuffer = await file.arrayBuffer();

  // JSZip is loaded globally from CDN
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library failed to load. Check your internet connection.');
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = Object.keys(zip.files).filter((p) => !shouldSkip(p));

  if (entries.length === 0) {
    throw new Error('Zip file is empty or contains no usable files.');
  }

  // Strip common root folder
  const { prefix, stripped } = stripCommonRoot(entries);

  // Extract file contents as ArrayBuffers
  const fileMap = {};
  for (let i = 0; i < entries.length; i++) {
    const originalPath = entries[i];
    const strippedPath = stripped[i];
    if (!strippedPath) continue; // skip if path becomes empty after stripping
    const content = await zip.files[originalPath].async('arraybuffer');
    fileMap[strippedPath] = content;
  }

  if (!fileMap['index.html']) {
    throw new Error('No index.html found in the zip. Invoco presentations require an index.html entry point.');
  }

  return { fileMap, prefix };
}

// --- UI ---

function showStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = 'status' + (isError ? ' error' : '');
}

function showUpload() {
  uploadView.classList.add('active');
  viewerView.classList.remove('active');
  viewerFrame.src = 'about:blank';
  fileName.textContent = '';
  showStatus('');
}

function showViewer(title) {
  uploadView.classList.remove('active');
  viewerView.classList.add('active');
  viewerTitle.textContent = title;
  viewerFrame.src = '/browse/view/index.html';
}

async function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showStatus('Please select a .zip file.', true);
    return;
  }

  fileName.textContent = file.name;
  showStatus('Extracting...');

  try {
    const { fileMap, prefix } = await extractZip(file);
    showStatus(`Sending ${Object.keys(fileMap).length} files to viewer...`);

    // Transfer files to SW. Convert ArrayBuffers to transferable.
    // We send the map as a plain object; the SW will store them.
    await sendToSW('LOAD_FILES', fileMap);

    // Derive a display title from the zip name or stripped prefix
    const title = prefix
      ? formatTitle(prefix.replace(/\/$/, ''))
      : formatTitle(file.name.replace(/\.zip$/i, ''));

    showViewer(title);
  } catch (err) {
    showStatus(err.message, true);
  }
}

function formatTitle(raw) {
  // "01-corporate-blue" -> "Corporate Blue"
  return raw
    .replace(/^\d+-/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Events ---

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files[0]);
  fileInput.value = ''; // reset so same file can be re-selected
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

uploadNewBtn.addEventListener('click', async () => {
  await sendToSW('CLEAR_FILES');
  showUpload();
});

// --- Init ---

(async () => {
  try {
    await registerSW();
    showStatus('Ready. Upload a zipped presentation.');
  } catch (err) {
    showStatus(err.message, true);
  }
})();
