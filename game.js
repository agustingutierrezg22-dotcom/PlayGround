(() => {
  const COLS = 10, ROWS = 20;
  const SHAPES = [
    { name: 'spruce', color: '#78a75b', light: '#a5cf78', dark: '#4c7144', map: [[1,1,1,1]] },
    { name: 'stone', color: '#84908b', light: '#b5c1b2', dark: '#57625e', map: [[1,0,0],[1,1,1]] },
    { name: 'oak', color: '#d49a54', light: '#f0c77a', dark: '#99613b', map: [[0,0,1],[1,1,1]] },
    { name: 'moss', color: '#d7c36e', light: '#f1df99', dark: '#a48c45', map: [[1,1],[1,1]] },
    { name: 'glass', color: '#5aa79a', light: '#a3ded0', dark: '#357569', map: [[0,1,1],[1,1,0]] },
    { name: 'brick', color: '#c77656', light: '#efaa7b', dark: '#914b3e', map: [[0,1,0],[1,1,1]] },
    { name: 'clay', color: '#8a7bc1', light: '#b9a9e8', dark: '#5d528b', map: [[1,1,0],[0,1,1]] }
  ];
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
  const houseCanvas = $('houseCanvas'), houseCtx = houseCanvas.getContext('2d');
  const nextCanvas = $('nextCanvas'), nextCtx = nextCanvas.getContext('2d');
  let board, piece, nextPiece, score = 0, lines = 0, level = 1, running = false, started = false, gameOver = false;
  let dropTimer = 0, lastTime = 0, particles = [], audioOn = false, audioCtx = null;
  let best = Number(localStorage.getItem('blockBuildBest') || 0);
  $('bestScore').textContent = String(best).padStart(6, '0');

  function cloneShape(shape) { return { ...shape, map: shape.map.map(row => row.slice()) }; }
  function randomShape() { return cloneShape(SHAPES[Math.floor(Math.random() * SHAPES.length)]); }
  function newPiece(shape) { return { shape: shape || randomShape(), x: 3, y: -1 }; }
  function resetGame() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0; lines = 0; level = 1; gameOver = false; started = true; running = true; dropTimer = 0;
    particles = []; piece = newPiece(randomShape()); nextPiece = randomShape();
    $('startOverlay').classList.add('hidden'); $('pauseOverlay').classList.add('hidden'); $('gameOverOverlay').classList.add('hidden');
    document.body.classList.add('controls-active');
    $('statusText').textContent = 'BUILDING IN PROGRESS'; updateHud(); requestAnimationFrame(loop);
  }
  function updateHud() {
    $('score').textContent = String(score).padStart(6, '0'); $('lines').textContent = String(lines).padStart(2, '0');
    $('level').textContent = String(level).padStart(2, '0');
    if (score > best) { best = score; localStorage.setItem('blockBuildBest', best); }
    $('bestScore').textContent = String(best).padStart(6, '0');
    const progress = Math.min(lines, 6);
    $('progressText').textContent = progress;
    $('progressBar').style.width = `${(progress / 6) * 100}%`;
    const phases = ['A place to begin', 'Laying the foundation', 'Walls are taking shape', 'Let the light in', 'A roof over your head', 'Adding the little details', 'Home sweet home'];
    $('buildPhase').textContent = phases[progress];
    renderMaterials(); drawNext(); drawHouse();
  }
  function renderMaterials() {
    const items = [
      ['Spruce', '#78a75b', Math.floor(lines * 4 + lines / 3)],
      ['Stone', '#84908b', Math.floor(lines * 3 + lines / 2)],
      ['Oak', '#d49a54', Math.floor(lines * 2 + lines / 4)],
      ['Glass', '#5aa79a', Math.max(0, lines - 2)]
    ];
    $('materials').innerHTML = items.map(([name, color, count]) => `<div class="material"><i class="material-cube" style="--mat:${color}"></i><span class="material-name">${name}</span><b class="material-count">${String(count).padStart(2, '0')}</b></div>`).join('');
  }
  function collides(p, dx = 0, dy = 0, map = p.shape.map) {
    for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++) if (map[y][x]) {
      const bx = p.x + x + dx, by = p.y + y + dy;
      if (bx < 0 || bx >= COLS || by >= ROWS || (by >= 0 && board[by][bx])) return true;
    }
    return false;
  }
  function rotateMap(map) { return map[0].map((_, i) => map.map(row => row[i]).reverse()); }
  function rotate() {
    if (!running) return;
    const rotated = rotateMap(piece.shape.map);
    for (const kick of [0, -1, 1, -2, 2]) if (!collides(piece, kick, 0, rotated)) { piece.shape.map = rotated; piece.x += kick; return; }
  }
  function move(dx, dy) {
    if (!running) return;
    if (!collides(piece, dx, dy)) { piece.x += dx; piece.y += dy; return true; }
    if (dy > 0) lockPiece();
    return false;
  }
  function lockPiece() {
    let above = false;
    piece.shape.map.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return;
      const by = piece.y + y, bx = piece.x + x;
      if (by < 0) above = true;
      else board[by][bx] = piece.shape;
    }));
    if (above) { endGame(); return; }
    const cleared = [];
    for (let y = ROWS - 1; y >= 0; y--) if (board[y].every(Boolean)) { cleared.push(y); board.splice(y, 1); board.unshift(Array(COLS).fill(null)); y++; }
    if (cleared.length) {
      const points = [0, 100, 300, 500, 800][cleared.length] || 1000;
      score += points * level; lines += cleared.length; level = Math.floor(lines / 6) + 1;
      cleared.forEach(y => { for (let x = 0; x < COLS; x++) particles.push({ x, y, t: 0, color: piece.shape.light }); });
      playTone(680, .12); updateHud();
    } else score += 4;
    piece = newPiece(nextPiece); nextPiece = randomShape(); updateHud();
    if (collides(piece)) endGame();
  }
  function hardDrop() { if (!running) return; let distance = 0; while (!collides(piece, 0, 1)) { piece.y++; distance++; } score += distance * 2; lockPiece(); updateHud(); }
  function endGame() { running = false; gameOver = true; document.body.classList.remove('controls-active'); $('statusText').textContent = 'WORLD COMPLETE'; $('gameOverOverlay').classList.remove('hidden'); }
  function togglePause() {
    if (!started || gameOver) return;
    running = !running; document.body.classList.toggle('controls-active', running); $('pauseOverlay').classList.toggle('hidden', running); $('statusText').textContent = running ? 'BUILDING IN PROGRESS' : 'TAKE A BREATHER';
    if (running) { lastTime = performance.now(); requestAnimationFrame(loop); }
  }
  function loop(now) {
    if (!running) { drawGame(); return; }
    const dt = now - (lastTime || now); lastTime = now; dropTimer += dt;
    if (dropTimer > Math.max(90, 720 - (level - 1) * 55)) { move(0, 1); dropTimer = 0; }
    particles = particles.filter(p => p.t < 22); particles.forEach(p => p.t++);
    drawGame(); requestAnimationFrame(loop);
  }

  function resizeCanvas(c, context, draw, width, height) {
    const rect = c.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
    context.setTransform(c.width / width, 0, 0, c.height / height, 0, 0); draw();
  }
  function drawCell(context, x, y, s, shape, alpha = 1) {
    context.save(); context.globalAlpha = alpha;
    const bevel = Math.max(2, s * .14);
    context.fillStyle = shape.color; context.fillRect(x + 1, y + 1, s - 2, s - 2);
    context.fillStyle = shape.light; context.beginPath(); context.moveTo(x + 1, y + 1); context.lineTo(x + s - 1, y + 1); context.lineTo(x + s - bevel, y + bevel); context.lineTo(x + bevel, y + bevel); context.closePath(); context.fill();
    context.fillStyle = shape.dark; context.beginPath(); context.moveTo(x + s - 1, y + 1); context.lineTo(x + s - 1, y + s - 1); context.lineTo(x + s - bevel, y + s - bevel); context.lineTo(x + s - bevel, y + bevel); context.closePath(); context.fill();
    context.fillStyle = 'rgba(255,255,255,.16)'; context.fillRect(x + bevel + 2, y + bevel + 2, Math.max(2, s * .12), Math.max(2, s * .12));
    context.strokeStyle = 'rgba(10,20,13,.4)'; context.lineWidth = 1; context.strokeRect(x + .5, y + .5, s - 1, s - 1); context.restore();
  }
  function drawGame() {
    const W = 300, H = 440; ctx.clearRect(0, 0, W, H);
    const cell = 22, ox = 40, oy = 0;
    ctx.fillStyle = 'rgba(7,13,9,.35)'; ctx.fillRect(ox - 3, oy, COLS * cell + 6, ROWS * cell + 2);
    ctx.fillStyle = '#142018'; ctx.fillRect(ox, oy, COLS * cell, ROWS * cell);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? 'rgba(182,210,165,.035)' : 'rgba(182,210,165,.018)';
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      ctx.strokeStyle = 'rgba(173,197,156,.075)'; ctx.lineWidth = .6; ctx.strokeRect(ox + x * cell, oy + y * cell, cell, cell);
      if (board?.[y]?.[x]) drawCell(ctx, ox + x * cell, oy + y * cell, cell, board[y][x]);
    }
    if (piece && !gameOver) {
      let ghostY = piece.y; while (!collides({ ...piece, y: ghostY }, 0, 1)) ghostY++;
      piece.shape.map.forEach((row, y) => row.forEach((cellOn, x) => {
        if (!cellOn) return;
        const px = ox + (piece.x + x) * cell, py = oy + (ghostY + y) * cell;
        if (py >= 0) { ctx.strokeStyle = 'rgba(211,232,184,.38)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]); ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4); ctx.setLineDash([]); }
      }));
      piece.shape.map.forEach((row, y) => row.forEach((cellOn, x) => { if (cellOn && piece.y + y >= 0) drawCell(ctx, ox + (piece.x + x) * cell, oy + (piece.y + y) * cell, cell, piece.shape); }));
    }
    particles.forEach(p => { ctx.globalAlpha = 1 - p.t / 22; ctx.fillStyle = p.color; ctx.fillRect(ox + p.x * cell + 4, oy + p.y * cell + 4 - p.t, cell - 8, cell - 8); }); ctx.globalAlpha = 1;
  }
  function drawNext() {
    nextCtx.clearRect(0, 0, 100, 66); if (!nextPiece) return;
    const m = nextPiece.map, s = 16, w = m[0].length * s, h = m.length * s, ox = (100 - w) / 2, oy = (66 - h) / 2;
    m.forEach((row,y)=>row.forEach((v,x)=>{if(v) drawCell(nextCtx,ox+x*s,oy+y*s,s,nextPiece);}));
  }

  function voxel(c, cx, y, bw, bh, bd, colors) {
    const [top, left, right] = colors;
    c.fillStyle = left; c.beginPath(); c.moveTo(cx - bw/2, y + bd/2); c.lineTo(cx, y + bd); c.lineTo(cx, y + bd + bh); c.lineTo(cx - bw/2, y + bd/2 + bh); c.closePath(); c.fill();
    c.fillStyle = right; c.beginPath(); c.moveTo(cx, y + bd); c.lineTo(cx + bw/2, y + bd/2); c.lineTo(cx + bw/2, y + bd/2 + bh); c.lineTo(cx, y + bd + bh); c.closePath(); c.fill();
    c.fillStyle = top; c.beginPath(); c.moveTo(cx, y); c.lineTo(cx + bw/2, y + bd/2); c.lineTo(cx, y + bd); c.lineTo(cx - bw/2, y + bd/2); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(25,34,21,.24)'; c.lineWidth = .7; c.beginPath(); c.moveTo(cx,y); c.lineTo(cx+bw/2,y+bd/2); c.lineTo(cx+bw/2,y+bd/2+bh); c.moveTo(cx+bw/2,y+bd/2); c.lineTo(cx,y+bd); c.lineTo(cx,y+bd+bh); c.stroke();
  }
  function drawHouse() {
    const c = houseCtx, W = 360, H = 220; c.clearRect(0,0,W,H);
    // Soft pixel clouds and a low-poly hillside
    c.fillStyle = 'rgba(210,221,176,.25)'; c.fillRect(48,34,39,7); c.fillRect(58,27,19,7); c.fillRect(258,52,43,6); c.fillRect(270,45,20,7);
    c.fillStyle = '#75865a'; c.beginPath(); c.moveTo(0,133); c.lineTo(72,102); c.lineTo(130,131); c.lineTo(235,96); c.lineTo(360,127); c.lineTo(360,220); c.lineTo(0,220); c.closePath(); c.fill();
    c.fillStyle = '#60774b'; c.fillRect(0,145,360,75);
    // Tiny pines at the edges
    function pine(x,y,scale) { c.fillStyle='#594a35'; c.fillRect(x-3*scale,y+15*scale,6*scale,20*scale); c.fillStyle='#344d3a'; for(let i=0;i<3;i++){c.beginPath();c.moveTo(x,y-25*scale+i*13*scale);c.lineTo(x-15*scale+i*3*scale,y+5*scale+i*8*scale);c.lineTo(x+15*scale-i*3*scale,y+5*scale+i*8*scale);c.closePath();c.fill();} }
    pine(48,119,.75); pine(314,116,.88);
    const stage = Math.min(lines,6), baseX = 180, baseY = 139, bw=24, bh=17, bd=12;
    // A stitched little meadow path and foundation
    if(stage>=1){
      for(let r=3;r>=0;r--) for(let col=0;col<5;col++) {
        const cx=baseX+(col-r)*bw/2, y=baseY-(col+r)*bd/2;
        voxel(c,cx,y,bw,bh,bd,['#8d8053','#615a3d','#716844']);
      }
      for(let col=0;col<5;col++) voxel(c,baseX+(col-1)*bw/2,baseY-2*bd-1,bw,bh*.45,bd,['#9b8c5a','#6e6343','#7b704a']);
    }
    if(stage>=2){
      const wallLayers=stage>=3?3:2;
      for(let layer=0;layer<wallLayers;layer++) for(let r=2;r>=0;r--) for(let col=0;col<4;col++) {
        // Leave the doorway and windows as the walls rise
        if(stage>=3 && layer<2 && r===0 && col===1) continue;
        if(stage>=4 && layer===1 && r===2 && (col===0||col===3)) continue;
        const cx=baseX+2+(col-r)*bw/2, y=baseY-2*bd-1-(col+r)*bd/2-(layer+1)*bh*.82;
        const shade=(col+layer)%2 ? ['#d3a56a','#986743','#b27d4c'] : ['#e1b877','#a57449','#bf8955'];
        voxel(c,cx,y,bw,bh*.84,bd,shade);
      }
      // A dark oak door with a golden handle
      const doorX=baseX+2+(1-0)*bw/2, doorY=baseY-2*bd-bh*.82;
      c.fillStyle='#49372b'; c.fillRect(doorX-6,doorY-16,12,24); c.fillStyle='#d5bc72'; c.fillRect(doorX+3,doorY-6,2,2);
    }
    if(stage>=4){
      // Stepped spruce gable roof, broad at its eaves
      for(let r=3;r>=0;r--) for(let col=0;col<5;col++) {
        const cx=baseX+2+(col-r)*bw/2, y=baseY-2*bd-2*bh-(col+r)*bd/2-5;
        voxel(c,cx,y,bw+1,7,bd+2,['#a94f3f','#713c36','#8e4239']);
      }
      for(let col=0;col<5;col++) voxel(c,baseX+2+(col-1.5)*bw/2,baseY-2*bd-2*bh-4-col*bd/2,bw,7,bd+2,['#bf6045','#854037','#a14c3d']);
    }
    if(stage>=5){
      // Bright windows with cross-panes
      for(const wx of [baseX-7,baseX+38]) { c.fillStyle='#75c1b1'; c.fillRect(wx,baseY-2*bd-2*bh+2,11,11); c.strokeStyle='#e7d09a'; c.lineWidth=2; c.strokeRect(wx,baseY-2*bd-2*bh+2,11,11); c.beginPath(); c.moveTo(wx+5.5,baseY-2*bd-2*bh+2); c.lineTo(wx+5.5,baseY-2*bd-2*bh+13); c.moveTo(wx,baseY-2*bd-2*bh+7.5); c.lineTo(wx+11,baseY-2*bd-2*bh+7.5); c.stroke(); }
      // Chimney
      c.fillStyle='#9f5747'; c.fillRect(baseX+27,baseY-75,10,26); c.fillStyle='#c77759'; c.fillRect(baseX+25,baseY-78,14,5);
    }
    if(stage>=6){
      // stepping stones, flower pops and a lantern
      for(let i=0;i<4;i++){c.fillStyle=i%2?'#b4a779':'#d0c293';c.fillRect(baseX-17+i*10,baseY+12+i*5,7,4);}
      for(const [fx,fy,col] of [[105,148,'#e8c86b'],[265,151,'#d8879a'],[119,160,'#d8e6a0']]){c.fillStyle='#8cbd68';c.fillRect(fx,fy,2,9);c.fillStyle=col;c.fillRect(fx-2,fy-3,6,5);}
      c.fillStyle='#e5cb78';c.fillRect(baseX+48,baseY-3,5,8); c.fillStyle='rgba(236,212,125,.18)';c.beginPath();c.arc(baseX+50,baseY+1,13,0,Math.PI*2);c.fill();
    }
    // foreground grass pixels
    for(let i=0;i<38;i++){const x=(i*47+17)%360, y=160+(i*29)%50;c.fillStyle=i%3?'rgba(181,199,119,.5)':'rgba(221,193,111,.55)';c.fillRect(x,y,2,2);}
  }
  function playTone(freq, duration) {
    if (!audioOn) return;
    try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.035,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration); } catch (_) {}
  }
  function action(name) {
    if (!started) { if(name==='drop'||name==='rotate'||name==='down'||name==='left'||name==='right') resetGame(); return; }
    if (name==='pause') { togglePause(); return; }
    if (!running) return;
    if (name==='left') move(-1,0); else if(name==='right') move(1,0); else if(name==='down'){ if(move(0,1)){score++;updateHud();} }
    else if(name==='rotate') rotate(); else if(name==='drop') hardDrop();
    drawGame();
  }
  document.addEventListener('keydown', e => {
    const keys={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowDown:'down',KeyS:'down',ArrowUp:'rotate',KeyW:'rotate',Space:'drop',KeyP:'pause',Escape:'pause',Enter:'start'};
    const a=keys[e.code]; if(!a)return; e.preventDefault();
    if(a==='start'){if(!started||gameOver)resetGame();else if(!running)togglePause();return;} action(a);
  });
  $('startBtn').addEventListener('click',resetGame); $('againBtn').addEventListener('click',resetGame); $('restartBtn').addEventListener('click',resetGame); $('resumeBtn').addEventListener('click',togglePause);
  document.querySelectorAll('.touch-controls button').forEach(button=>{
    const a=button.dataset.action;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);action(a);});
  });
  $('soundBtn').addEventListener('click',()=>{audioOn=!audioOn;$('soundIcon').textContent=audioOn?'♫':'♪';$('soundBtn').style.borderColor=audioOn?'#9ab65d':'';if(audioOn)playTone(540,.08);});
  function resizeAll() {
    resizeCanvas(canvas,ctx,drawGame,300,440);
    resizeCanvas(houseCanvas,houseCtx,drawHouse,360,220);
    resizeCanvas(nextCanvas,nextCtx,drawNext,100,66);
  }
  window.addEventListener('resize',resizeAll);
  board=Array.from({length:ROWS},()=>Array(COLS).fill(null)); piece=null; nextPiece=randomShape();
  resizeAll(); updateHud(); drawGame();
})();
