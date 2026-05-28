/**
 * editor.js — Player keyframe annotation tool (Tap Any Player).
 *
 * Standalone editor (editor.html). Saves data to localStorage.
 * The experience (index.html) reads the same localStorage key.
 * Each "look" = one player tracked across the clip.
 */

(function() {
  'use strict';

  // ─── Constants ──────────────────────────────────────
  const STORAGE_KEY = 'shop-moment-data';
  const FRAME_STEP = 1 / 60; // psg_goal.mp4 is 60fps
  const COLORS = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
    '#ffeaa7', '#c9b1ff', '#ffb3ba', '#a0d2db'
  ];

  // ─── Undo history ───────────────────────────────────
  const undoStack = [];
  const MAX_UNDO = 50;

  function pushUndo() {
    undoStack.push(JSON.stringify(state.looks));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoBtn();
  }

  function undo() {
    if (!undoStack.length) return;
    const snapshot = undoStack.pop();
    state.looks = JSON.parse(snapshot);
    // Make sure activeLookId still exists
    if (!state.looks.find(l => l.id === state.activeLookId)) {
      state.activeLookId = state.looks.length ? state.looks[0].id : null;
      state.activePieceId = null;
    }
    // Make sure activePieceId still exists
    if (state.activePieceId) {
      const look = state.looks.find(l => l.id === state.activeLookId);
      if (!look || !(look.pieces || []).find(p => p.id === state.activePieceId)) {
        state.activePieceId = null;
      }
    }
    save();
    renderUI();
  }

  function updateUndoBtn() {
    const btn = document.getElementById('btn-undo');
    if (btn) btn.disabled = undoStack.length === 0;
  }

  // ─── State ──────────────────────────────────────────
  const state = {
    looks: [],
    activeLookId: null,
    activePieceId: null,  // null = drawing to look-level keyframes
    isDrawing: false,
    drawStart: null,
    drawCurrent: null,
    wasPlaying: false,
  };

  // ─── DOM refs (set in init) ─────────────────────────
  let video, canvas, ctx, videoContainer;
  let btnPlay, btnStepBack, btnStepFwd;
  let timeDisplay, durationDisplay;
  let scrubber, scrubberFill, keyframeMarkers;
  let looksList, keyframesList, keyframeHint, editorStatus;

  // ═══════════════════════════════════════════════════════
  // CANVAS
  // ═══════════════════════════════════════════════════════

  function resizeCanvas() {
    canvas.width = videoContainer.clientWidth;
    canvas.height = videoContainer.clientHeight;
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawBox(box, color, alpha) {
    const vRect = App.utils.getVideoRect(video, videoContainer);
    const x = vRect.x + box.x1 * vRect.width;
    const y = vRect.y + box.y1 * vRect.height;
    const w = (box.x2 - box.x1) * vRect.width;
    const h = (box.y2 - box.y1) * vRect.height;

    const { r, g, b } = App.utils.hexToRgb(color);

    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawLabel(box, text, color) {
    const vRect = App.utils.getVideoRect(video, videoContainer);

    // Anchor to the right edge of the box, vertically centered
    const anchorX = vRect.x + box.x2 * vRect.width + 10;
    const anchorY = vRect.y + (box.y1 + box.y2) / 2 * vRect.height;

    ctx.font = '11px system-ui, -apple-system, sans-serif';
    const metrics = ctx.measureText(text);
    const pad = 6;
    const bgW = metrics.width + pad * 2;
    const bgH = 20;

    const { r, g, b } = App.utils.hexToRgb(color);

    // Background
    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
    ctx.beginPath();
    ctx.roundRect(anchorX, anchorY - bgH / 2, bgW, bgH, 3);
    ctx.fill();

    // Text
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, anchorX + pad, anchorY);
  }

  // ═══════════════════════════════════════════════════════
  // PREVIEW LOOP
  // ═══════════════════════════════════════════════════════

  function lightenColor(hex, amount) {
    const { r, g, b } = App.utils.hexToRgb(hex);
    const lr = Math.min(255, r + amount);
    const lg = Math.min(255, g + amount);
    const lb = Math.min(255, b + amount);
    return '#' + [lr, lg, lb].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function renderFrame() {
    clearCanvas();
    const t = video.currentTime;

    for (const look of state.looks) {
      const isActiveLook = look.id === state.activeLookId;

      // Look-level box
      const box = App.utils.interpolateBox(look.keyframes, t);
      if (box) {
        const isTarget = isActiveLook && !state.activePieceId;
        drawBox(box, look.color, isTarget ? 0.2 : 0.08);
        drawLabel(box, look.name, look.color);
      }

      // Piece-level boxes
      for (const piece of (look.pieces || [])) {
        const pBox = App.utils.interpolateBox(piece.keyframes, t);
        if (!pBox) continue;
        const pieceColor = lightenColor(look.color, 60);
        const isTarget = isActiveLook && state.activePieceId === piece.id;
        drawBox(pBox, pieceColor, isTarget ? 0.2 : 0.08);
        drawLabel(pBox, piece.name, pieceColor);
      }
    }

    // Draw in-progress rectangle
    if (state.isDrawing && state.drawStart && state.drawCurrent) {
      const box = makeBoxFromPoints(state.drawStart, state.drawCurrent);
      const activeLook = state.looks.find(l => l.id === state.activeLookId);
      const color = activeLook ? activeLook.color : '#ffffff';
      drawBox(box, color, 0.25);
    }

    requestAnimationFrame(renderFrame);
  }

  // ═══════════════════════════════════════════════════════
  // BOX DRAWING
  // ═══════════════════════════════════════════════════════

  function makeBoxFromPoints(a, b) {
    return {
      x1: Math.min(a.x, b.x),
      y1: Math.min(a.y, b.y),
      x2: Math.max(a.x, b.x),
      y2: Math.max(a.y, b.y),
    };
  }

  function onDrawStart(e) {
    if (!state.activeLookId) return;
    if (e.button && e.button !== 0) return; // left click only
    e.preventDefault();

    state.wasPlaying = !video.paused;
    if (!video.paused) video.pause();

    state.isDrawing = true;
    state.drawStart = App.utils.eventToVideoPercent(e, video, videoContainer);
    state.drawCurrent = state.drawStart;
  }

  function onDrawMove(e) {
    if (!state.isDrawing) return;
    e.preventDefault();
    state.drawCurrent = App.utils.eventToVideoPercent(e, video, videoContainer);
  }

  function onDrawEnd(e) {
    if (!state.isDrawing) return;
    e.preventDefault();

    const end = App.utils.eventToVideoPercent(e, video, videoContainer);
    const box = makeBoxFromPoints(state.drawStart, end);

    // Minimum size check — ignore tiny accidental clicks
    if (box.x2 - box.x1 > 0.02 && box.y2 - box.y1 > 0.02) {
      addKeyframe(state.activeLookId, video.currentTime, box);
    }

    state.isDrawing = false;
    state.drawStart = null;
    state.drawCurrent = null;
  }

  // ═══════════════════════════════════════════════════════
  // LOOK MANAGEMENT
  // ═══════════════════════════════════════════════════════

  function addLook(name) {
    pushUndo();
    const id = 'look-' + App.utils.randomId();
    const colorIdx = state.looks.length % COLORS.length;
    state.looks.push({
      id,
      name,
      color: COLORS[colorIdx],
      keyframes: [],
      pieces: []
    });
    state.activeLookId = id;
    save();
    renderUI();
  }

  let _selectLookTimer = null;
  function selectLook(id) {
    clearTimeout(_selectLookTimer);
    _selectLookTimer = setTimeout(() => {
      state.activeLookId = id;
      state.activePieceId = null;
      renderUI();
    }, 250);
  }

  function renameLook(id) {
    const look = state.looks.find(l => l.id === id);
    if (!look) return;
    const newName = prompt('Rename player:', look.name);
    if (newName && newName.trim() && newName.trim() !== look.name) {
      pushUndo();
      look.name = newName.trim();
      save();
      renderUI();
    }
  }

  // Two-step delete: first click shows confirm state, second click (within 3s) deletes
  let pendingDeleteId = null;
  let pendingDeleteTimer = null;

  function requestDeleteLook(id) {
    if (pendingDeleteId === id) {
      // Second click — actually delete
      clearTimeout(pendingDeleteTimer);
      pendingDeleteId = null;
      deleteLook(id);
    } else {
      // First click — enter confirm state
      clearTimeout(pendingDeleteTimer);
      pendingDeleteId = id;
      renderLooksList();
      // Reset after 3 seconds if not confirmed
      pendingDeleteTimer = setTimeout(() => {
        pendingDeleteId = null;
        renderLooksList();
      }, 3000);
    }
  }

  function deleteLook(id) {
    pushUndo();
    state.looks = state.looks.filter(l => l.id !== id);
    if (state.activeLookId === id) {
      state.activeLookId = state.looks.length ? state.looks[0].id : null;
    }
    save();
    renderUI();
  }

  // ═══════════════════════════════════════════════════════
  // PIECE MANAGEMENT
  // ═══════════════════════════════════════════════════════

  function addPiece(lookId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const name = prompt('Piece name:');
    if (!name || !name.trim()) return;
    pushUndo();
    if (!look.pieces) look.pieces = [];
    const piece = {
      id: 'piece-' + App.utils.randomId(),
      name: name.trim(),
      keyframes: []
    };
    look.pieces.push(piece);
    state.activePieceId = piece.id;
    save();
    renderUI();
  }

  function selectPiece(lookId, pieceId) {
    state.activeLookId = lookId;
    state.activePieceId = pieceId;
    renderUI();
  }

  function renamePiece(lookId, pieceId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const piece = (look.pieces || []).find(p => p.id === pieceId);
    if (!piece) return;
    const newName = prompt('Rename piece:', piece.name);
    if (newName && newName.trim() && newName.trim() !== piece.name) {
      pushUndo();
      piece.name = newName.trim();
      save();
      renderUI();
    }
  }

  let pendingDeletePieceId = null;
  let pendingDeletePieceTimer = null;

  function requestDeletePiece(lookId, pieceId) {
    if (pendingDeletePieceId === pieceId) {
      clearTimeout(pendingDeletePieceTimer);
      pendingDeletePieceId = null;
      deletePiece(lookId, pieceId);
    } else {
      clearTimeout(pendingDeletePieceTimer);
      pendingDeletePieceId = pieceId;
      renderLooksList();
      pendingDeletePieceTimer = setTimeout(() => {
        pendingDeletePieceId = null;
        renderLooksList();
      }, 3000);
    }
  }

  function deletePiece(lookId, pieceId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    pushUndo();
    look.pieces = (look.pieces || []).filter(p => p.id !== pieceId);
    if (state.activePieceId === pieceId) state.activePieceId = null;
    save();
    renderUI();
  }

  function moveKeyframeToPiece(lookId, kfId, pieceId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const kfIdx = look.keyframes.findIndex(k => k.id === kfId);
    if (kfIdx < 0) return;
    const piece = (look.pieces || []).find(p => p.id === pieceId);
    if (!piece) return;
    pushUndo();
    const kf = look.keyframes.splice(kfIdx, 1)[0];
    piece.keyframes.push(kf);
    piece.keyframes.sort((a, b) => a.time - b.time);
    save();
    renderUI();
  }

  function moveKeyframeToLook(lookId, pieceId, kfId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const piece = (look.pieces || []).find(p => p.id === pieceId);
    if (!piece) return;
    const kfIdx = piece.keyframes.findIndex(k => k.id === kfId);
    if (kfIdx < 0) return;
    pushUndo();
    const kf = piece.keyframes.splice(kfIdx, 1)[0];
    look.keyframes.push(kf);
    look.keyframes.sort((a, b) => a.time - b.time);
    save();
    renderUI();
  }

  // ═══════════════════════════════════════════════════════
  // KEYFRAME MANAGEMENT
  // ═══════════════════════════════════════════════════════

  function addKeyframe(lookId, time, box) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;

    pushUndo();
    const kf = {
      id: 'kf-' + App.utils.randomId(),
      time: Math.round(time * 1000) / 1000,
      box,
      jump: false,
      hide: false
    };

    // Add to piece keyframes if a piece is active, else to look-level
    if (state.activePieceId) {
      const piece = (look.pieces || []).find(p => p.id === state.activePieceId);
      if (piece) {
        piece.keyframes.push(kf);
        piece.keyframes.sort((a, b) => a.time - b.time);
      }
    } else {
      look.keyframes.push(kf);
      look.keyframes.sort((a, b) => a.time - b.time);
    }

    save();
    renderUI();
  }

  function deleteKeyframe(lookId, kfId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    pushUndo();

    // Try look-level first
    const before = look.keyframes.length;
    look.keyframes = look.keyframes.filter(k => k.id !== kfId);
    if (look.keyframes.length === before) {
      // Not found at look level — search pieces
      for (const piece of (look.pieces || [])) {
        piece.keyframes = piece.keyframes.filter(k => k.id !== kfId);
      }
    }

    save();
    renderUI();
  }

  function findKeyframe(look, kfId) {
    let kf = look.keyframes.find(k => k.id === kfId);
    if (kf) return kf;
    for (const piece of (look.pieces || [])) {
      kf = piece.keyframes.find(k => k.id === kfId);
      if (kf) return kf;
    }
    return null;
  }

  function toggleJump(lookId, kfId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const kf = findKeyframe(look, kfId);
    if (!kf) return;
    kf.jump = !kf.jump;
    if (kf.jump) kf.hide = false;
    save();
    renderUI();
  }

  function toggleHide(lookId, kfId) {
    const look = state.looks.find(l => l.id === lookId);
    if (!look) return;
    const kf = findKeyframe(look, kfId);
    if (!kf) return;
    kf.hide = !kf.hide;
    if (kf.hide) kf.jump = false;
    save();
    renderUI();
  }

  // ═══════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════

  function save() {
    const data = { looks: state.looks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    let looks = null;
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.looks && data.looks.length) {
          looks = data.looks;
        }
      } catch (e) {
        console.warn('Failed to load saved data:', e);
      }
    }
    // Fall back to data.js
    if (!looks && App.lookData && App.lookData.looks) {
      looks = JSON.parse(JSON.stringify(App.lookData.looks));
    }
    if (!looks) return;
    state.looks = looks;
    // Migration: ensure pieces array and keyframe IDs
    for (const look of state.looks) {
      if (!look.pieces) look.pieces = [];
      for (const kf of look.keyframes) {
        if (!kf.id) kf.id = 'kf-' + App.utils.randomId();
      }
      for (const piece of look.pieces) {
        if (!piece.id) piece.id = 'piece-' + App.utils.randomId();
        if (!piece.keyframes) piece.keyframes = [];
        for (const kf of piece.keyframes) {
          if (!kf.id) kf.id = 'kf-' + App.utils.randomId();
        }
      }
    }
    if (state.looks.length) {
      state.activeLookId = state.looks[0].id;
    }
  }

  function mapKeyframes(kfs) {
    return kfs.map(k => ({
      time: k.time,
      box: k.box,
      jump: k.jump,
      hide: k.hide || false
    }));
  }

  function exportJSON() {
    const exportData = {
      looks: state.looks.map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
        keyframes: mapKeyframes(l.keyframes),
        pieces: (l.pieces || []).map(p => ({
          id: p.id,
          name: p.name,
          keyframes: mapKeyframes(p.keyframes)
        }))
      }))
    };

    const json = JSON.stringify(exportData, null, 2);
    const dialog = document.getElementById('json-dialog');
    const textarea = document.getElementById('json-textarea');
    document.getElementById('json-dialog-title').textContent = 'Export JSON';
    textarea.value = json;
    textarea.readOnly = true;
    document.getElementById('btn-dialog-import').style.display = 'none';
    document.getElementById('btn-copy').style.display = '';
    dialog.showModal();
  }

  function openImport() {
    const dialog = document.getElementById('json-dialog');
    const textarea = document.getElementById('json-textarea');
    document.getElementById('json-dialog-title').textContent = 'Import JSON';
    textarea.value = '';
    textarea.readOnly = false;
    document.getElementById('btn-dialog-import').style.display = '';
    document.getElementById('btn-copy').style.display = 'none';
    dialog.showModal();
  }

  function doImport() {
    const textarea = document.getElementById('json-textarea');
    try {
      const data = JSON.parse(textarea.value);
      if (!data.looks || !Array.isArray(data.looks)) {
        alert('Invalid format: expected { looks: [...] }');
        return;
      }
      state.looks = data.looks.map(l => ({
        ...l,
        id: l.id || 'look-' + App.utils.randomId(),
        keyframes: (l.keyframes || []).map(k => ({
          ...k,
          id: k.id || 'kf-' + App.utils.randomId()
        })),
        pieces: (l.pieces || []).map(p => ({
          ...p,
          id: p.id || 'piece-' + App.utils.randomId(),
          keyframes: (p.keyframes || []).map(k => ({
            ...k,
            id: k.id || 'kf-' + App.utils.randomId()
          }))
        }))
      }));
      state.activeLookId = state.looks.length ? state.looks[0].id : null;
      save();
      renderUI();
      document.getElementById('json-dialog').close();
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════
  // UI RENDERING
  // ═══════════════════════════════════════════════════════

  function renderUI() {
    renderLooksList();
    renderKeyframesList();
    renderScrubberMarkers();
    updateStatus();
  }

  function renderLooksList() {
    let html = '';
    for (const look of state.looks) {
      const isActiveLook = look.id === state.activeLookId;
      const isLookTarget = isActiveLook && !state.activePieceId;
      const isConfirming = pendingDeleteId === look.id;
      const totalKf = look.keyframes.length + (look.pieces || []).reduce((sum, p) => sum + p.keyframes.length, 0);

      html += '<div class="look-item' + (isLookTarget ? ' active' : '') + '" data-look-id="' + look.id + '">'
        + '<span class="look-color" style="background:' + look.color + '"></span>'
        + '<span class="look-name">' + look.name + '</span>'
        + '<button class="look-rename" data-rename-look="' + look.id + '" title="Rename">&#9998;</button>'
        + '<span class="look-count">' + totalKf + '</span>'
        + '<button class="look-delete' + (isConfirming ? ' confirming' : '') + '" data-delete-look="' + look.id + '">'
        + (isConfirming ? 'Sure?' : '&times;')
        + '</button>'
        + '</div>';

      // Piece sub-items
      for (const piece of (look.pieces || [])) {
        const isPieceActive = isActiveLook && state.activePieceId === piece.id;
        const isPieceConfirming = pendingDeletePieceId === piece.id;
        html += '<div class="piece-item' + (isPieceActive ? ' active' : '') + '" data-select-piece="' + piece.id + '" data-piece-look="' + look.id + '">'
          + '<span class="piece-color" style="background:' + lightenColor(look.color, 60) + '"></span>'
          + '<span class="piece-name" data-rename-piece="' + piece.id + '" data-piece-look="' + look.id + '" title="Double-click to rename">' + piece.name + '</span>'
          + '<span class="look-count">' + piece.keyframes.length + '</span>'
          + '<button class="look-delete' + (isPieceConfirming ? ' confirming' : '') + '" data-delete-piece="' + piece.id + '" data-piece-look="' + look.id + '">'
          + (isPieceConfirming ? 'Sure?' : '&times;')
          + '</button>'
          + '</div>';
      }

      // (Pieces feature hidden for Tap Any Player — one box per player.)
    }
    looksList.innerHTML = html;
  }

  function renderKeyframesList() {
    const look = state.looks.find(l => l.id === state.activeLookId);

    if (!look) {
      keyframeHint.style.display = '';
      keyframeHint.textContent = 'Add a look first, then draw boxes on the video';
      keyframesList.innerHTML = '';
      return;
    }

    // Determine which keyframes to show
    let keyframes;
    let isShowingPiece = false;
    let sourcePieceId = null;

    if (state.activePieceId) {
      const piece = (look.pieces || []).find(p => p.id === state.activePieceId);
      if (piece) {
        keyframes = piece.keyframes;
        isShowingPiece = true;
        sourcePieceId = piece.id;
      } else {
        keyframes = look.keyframes;
      }
    } else {
      keyframes = look.keyframes;
    }

    keyframeHint.style.display = keyframes.length ? 'none' : '';
    keyframeHint.textContent = 'Draw a box on the video to add a keyframe';

    let html = '';
    for (const kf of keyframes) {
      const isCurrent = Math.abs(kf.time - video.currentTime) < 0.05;
      html += '<div class="kf-item' + (isCurrent ? ' active' : '') + '" data-kf-time="' + kf.time + '">'
        + '<span class="kf-time">' + App.utils.formatTimePrecise(kf.time) + '</span>'
        + '<label class="kf-jump">'
        + '<input type="checkbox" ' + (kf.hide ? 'checked' : '') + ' data-toggle-hide="' + kf.id + '">'
        + 'hide</label>'
        + '<label class="kf-jump">'
        + '<input type="checkbox" ' + (kf.jump ? 'checked' : '') + ' data-toggle-jump="' + kf.id + '">'
        + 'jump</label>';

      // Move buttons
      if (isShowingPiece) {
        // Viewing a piece — offer "Move to Look"
        html += '<button class="kf-move" data-move-to-look="' + kf.id + '" data-from-piece="' + sourcePieceId + '">&uarr; Look</button>';
      } else if ((look.pieces || []).length) {
        // Viewing look-level — offer move to each piece
        for (const p of look.pieces) {
          html += '<button class="kf-move" data-move-to-piece="' + p.id + '" data-move-kf="' + kf.id + '">&darr; ' + p.name + '</button>';
        }
      }

      html += '<button class="kf-delete" data-delete-kf="' + kf.id + '">&times;</button>'
        + '</div>';
    }
    keyframesList.innerHTML = html;
  }

  function renderScrubberMarkers() {
    if (!video.duration) { keyframeMarkers.innerHTML = ''; return; }

    let html = '';
    for (const look of state.looks) {
      for (const kf of look.keyframes) {
        const pct = (kf.time / video.duration) * 100;
        html += '<div class="scrubber-marker" style="left:' + pct + '%;background:' + look.color + '"></div>';
      }
      for (const piece of (look.pieces || [])) {
        const pieceColor = lightenColor(look.color, 60);
        for (const kf of piece.keyframes) {
          const pct = (kf.time / video.duration) * 100;
          html += '<div class="scrubber-marker" style="left:' + pct + '%;background:' + pieceColor + '"></div>';
        }
      }
    }
    keyframeMarkers.innerHTML = html;
  }

  function updateTimeDisplay() {
    timeDisplay.textContent = App.utils.formatTimePrecise(video.currentTime);
    if (video.duration) {
      durationDisplay.textContent = App.utils.formatTimeShort(video.duration);
      const pct = (video.currentTime / video.duration) * 100;
      scrubberFill.style.width = pct + '%';
    }
  }

  function updatePlayButton() {
    btnPlay.textContent = video.paused ? '\u25B6' : '\u23F8';
  }

  function updateStatus() {
    if (!state.activeLookId) {
      editorStatus.textContent = 'Select or add a player to start tracking';
      editorStatus.style.opacity = '1';
    } else {
      const look = state.looks.find(l => l.id === state.activeLookId);
      if (!look) return;
      let label = 'Drawing: ' + look.name;
      if (state.activePieceId) {
        const piece = (look.pieces || []).find(p => p.id === state.activePieceId);
        if (piece) label += ' > ' + piece.name;
      }
      editorStatus.textContent = label;
      editorStatus.style.opacity = '0.7';
    }
  }

  // ═══════════════════════════════════════════════════════
  // VIDEO CONTROLS
  // ═══════════════════════════════════════════════════════

  function togglePlay() {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function stepFrame(direction) {
    video.pause();
    video.currentTime = Math.max(0, video.currentTime + direction * FRAME_STEP);
  }

  function scrubTo(e) {
    const rect = scrubber.getBoundingClientRect();
    const pct = App.utils.clamp((e.clientX - rect.left) / rect.width, 0, 1);
    video.currentTime = pct * video.duration;
  }

  // ═══════════════════════════════════════════════════════
  // EVENT WIRING
  // ═══════════════════════════════════════════════════════

  function init() {
    // DOM refs
    video = document.getElementById('video');
    canvas = document.getElementById('draw-overlay');
    ctx = canvas.getContext('2d');
    videoContainer = document.getElementById('video-container');
    btnPlay = document.getElementById('btn-play');
    btnStepBack = document.getElementById('btn-step-back');
    btnStepFwd = document.getElementById('btn-step-fwd');
    timeDisplay = document.getElementById('time-display');
    durationDisplay = document.getElementById('duration-display');
    scrubber = document.getElementById('scrubber');
    scrubberFill = document.getElementById('scrubber-fill');
    keyframeMarkers = document.getElementById('keyframe-markers');
    looksList = document.getElementById('looks-list');
    keyframesList = document.getElementById('keyframes-list');
    keyframeHint = document.getElementById('keyframe-hint');
    editorStatus = document.getElementById('editor-status');

    // Load saved data
    load();

    // Canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start render loop
    requestAnimationFrame(renderFrame);

    // Video events
    video.addEventListener('play', updatePlayButton);
    video.addEventListener('pause', updatePlayButton);
    video.addEventListener('timeupdate', () => {
      updateTimeDisplay();
      renderKeyframesList(); // highlight current keyframe
    });
    video.addEventListener('loadedmetadata', renderUI);

    // Video controls
    btnPlay.addEventListener('click', togglePlay);
    btnStepBack.addEventListener('click', () => stepFrame(-1));
    btnStepFwd.addEventListener('click', () => stepFrame(1));

    // Scrubber — support click and drag
    let isScrubbing = false;
    scrubber.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      scrubTo(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (isScrubbing) scrubTo(e);
    });
    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    // Drawing on canvas
    canvas.addEventListener('mousedown', onDrawStart);
    window.addEventListener('mousemove', onDrawMove);
    window.addEventListener('mouseup', onDrawEnd);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrame(e.shiftKey ? -30 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrame(e.shiftKey ? 30 : 1);
          break;
      }
    });

    // Panel click delegation
    document.addEventListener('click', (e) => {
      // Piece selection
      const pieceItem = e.target.closest('[data-select-piece]');
      if (pieceItem && !e.target.closest('.look-delete')) {
        selectPiece(pieceItem.dataset.pieceLook, pieceItem.dataset.selectPiece);
        return;
      }

      // Piece delete (two-step)
      const deletePieceBtn = e.target.closest('[data-delete-piece]');
      if (deletePieceBtn) {
        requestDeletePiece(deletePieceBtn.dataset.pieceLook, deletePieceBtn.dataset.deletePiece);
        return;
      }

      // Add piece
      const addPieceBtn = e.target.closest('[data-add-piece]');
      if (addPieceBtn) {
        addPiece(addPieceBtn.dataset.addPiece);
        return;
      }

      // Move keyframe to piece
      const moveToPieceBtn = e.target.closest('[data-move-to-piece]');
      if (moveToPieceBtn) {
        moveKeyframeToPiece(state.activeLookId, moveToPieceBtn.dataset.moveKf, moveToPieceBtn.dataset.moveToPiece);
        return;
      }

      // Move keyframe to look
      const moveToLookBtn = e.target.closest('[data-move-to-look]');
      if (moveToLookBtn) {
        moveKeyframeToLook(state.activeLookId, moveToLookBtn.dataset.fromPiece, moveToLookBtn.dataset.moveToLook);
        return;
      }

      // Look rename button
      const renameBtn = e.target.closest('[data-rename-look]');
      if (renameBtn) {
        renameLook(renameBtn.dataset.renameLook);
        return;
      }

      // Look selection
      const lookItem = e.target.closest('.look-item');
      if (lookItem && !e.target.closest('.look-delete')) {
        selectLook(lookItem.dataset.lookId);
        return;
      }

      // Look delete (two-step)
      const deleteLookBtn = e.target.closest('[data-delete-look]');
      if (deleteLookBtn) {
        requestDeleteLook(deleteLookBtn.dataset.deleteLook);
        return;
      }

      // Undo
      if (e.target.id === 'btn-undo' || e.target.closest('#btn-undo')) {
        undo();
        return;
      }

      // Add player
      if (e.target.id === 'btn-add-look') {
        const name = prompt('Player name:');
        if (name && name.trim()) addLook(name.trim());
        return;
      }

      // Keyframe seek
      const kfItem = e.target.closest('.kf-item');
      if (kfItem && !e.target.closest('.kf-delete') && !e.target.closest('.kf-jump') && !e.target.closest('.kf-move')) {
        video.currentTime = parseFloat(kfItem.dataset.kfTime);
        video.pause();
        return;
      }

      // Keyframe delete
      const deleteKfBtn = e.target.closest('[data-delete-kf]');
      if (deleteKfBtn) {
        deleteKeyframe(state.activeLookId, deleteKfBtn.dataset.deleteKf);
        return;
      }

      // Clear all data
      if (e.target.id === 'btn-clear-data') {
        if (confirm('Clear ALL tracking data? This cannot be undone.')) {
          localStorage.removeItem(STORAGE_KEY);
          state.looks = [];
          state.activeLookId = null;
          state.activePieceId = null;
          load(); // reload roster from data.js fallback
          renderUI();
        }
        return;
      }

      // Export
      if (e.target.id === 'btn-export') exportJSON();
      // Import
      if (e.target.id === 'btn-import') openImport();
      // Copy
      if (e.target.id === 'btn-copy') {
        navigator.clipboard.writeText(document.getElementById('json-textarea').value);
        e.target.textContent = 'Copied!';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
      }
      // Dialog close
      if (e.target.id === 'btn-dialog-close') {
        document.getElementById('json-dialog').close();
      }
      // Dialog import
      if (e.target.id === 'btn-dialog-import') doImport();
    });

    // Jump checkbox toggle
    document.addEventListener('change', (e) => {
      const jumpId = e.target.dataset.toggleJump;
      if (jumpId) toggleJump(state.activeLookId, jumpId);
      const hideId = e.target.dataset.toggleHide;
      if (hideId) toggleHide(state.activeLookId, hideId);
    });

    // Double-click to rename look or piece (cancel pending select to prevent re-render)
    document.addEventListener('dblclick', (e) => {
      clearTimeout(_selectLookTimer);
      const renamePieceEl = e.target.closest('[data-rename-piece]');
      if (renamePieceEl) {
        renamePiece(renamePieceEl.dataset.pieceLook, renamePieceEl.dataset.renamePiece);
        return;
      }
      const renameEl = e.target.closest('[data-rename-look]') || e.target.closest('.look-item');
      if (renameEl) {
        const lookId = renameEl.dataset.renameLook || renameEl.dataset.lookId;
        if (lookId) renameLook(lookId);
      }
    });

    // Ctrl/Cmd+Z for undo
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        undo();
      }
    });

    // Initial render
    renderUI();
    updatePlayButton();

    console.log(
      '%cTap Any Player \u2014 Editor',
      'font-weight:bold;font-size:14px',
      '\nSpace = play/pause',
      '\n\u2190/\u2192 = step frame',
      '\nShift+\u2190/\u2192 = step 1s',
      '\nDraw boxes on the video to track a player'
    );
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
