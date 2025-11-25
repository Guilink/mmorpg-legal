// public/game.js

import { CONFIG } from './js/Config.js';
import { 
    UI, 
    toggleForms, 
    showAuthError, 
    showGameInterface, 
    updateHUD, 
    updateDebug, 
    addLogMessage, 
    toggleChatFocus, 
    toggleStatusWindow,
    refreshStatusWindow,
    setupStatusWindowData,
    changeAttr,
    getTempAttributes // Necessário para enviar os dados alterados
} from './js/UIManager.js';
import { keys, setupInputs, getIsChatActive } from './js/InputManager.js';

// --- INICIALIZAÇÃO DO SOCKET ---
const socket = io();

// --- VARIÁVEIS GLOBAIS (THREE.JS & ESTADO) ---
let scene, camera, renderer, clock;
let environmentLayer; 
let myPlayer = null;
let myUsername = "";
let otherPlayers = {};
let monsters = {};
let monsterTemplates = {}; 
let mapProps = [];
let targetRing = null; // O objeto visual 3D do anel
let currentTargetId = null; // Quem é o meu alvo atual (objeto do monstro ou player)
let frameCount = 0;
let lastFpsTime = 0; 

// Vetores reutilizáveis
const tempVector = new THREE.Vector3();
const tempOrigin = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

// Audio
let bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = 0.3;

// Estado de Controle
let isMapLoading = false;
let isPlayerLoading = false;
let isAttacking = false; 
let isSitting = false;   
let currentMapConfig = null;
let lastPacketTime = 0;

// Dados RPG Locais
let myStats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };
let myLevel = 1, myXp = 0, myNextXp = 100, myPoints = 0;
let myAttributes = { str: 5, agi: 5, int: 5, vit: 5 };

// --- EXPOR FUNÇÕES PARA O HTML (WINDOW) ---
// Como é um módulo, o escopo é local. Precisamos pendurar no window o que o HTML chama via onclick.

window.toggleForms = toggleForms;
window.toggleStatusWindow = () => {
    // Antes de abrir, injeta os dados atuais no UIManager
    setupStatusWindowData(myAttributes, myPoints);
    toggleStatusWindow();
};
window.changeAttr = changeAttr; // Função importada do UIManager

window.performLogin = () => {
    const u = UI.inLoginUser.value;
    const p = UI.inLoginPass.value;
    if(!u || !p) return showAuthError('Preencha todos os campos', 'login');
    socket.emit('login', { username: u, password: p });
};

window.performRegister = () => {
    const u = UI.inRegUser.value;
    const p = UI.inRegPass.value;
    const p2 = UI.inRegPass2.value;
    if(!u || !p) return showAuthError('Preencha todos os campos', 'reg');
    if(p !== p2) return showAuthError('Senhas não conferem', 'reg');
    socket.emit('register', { username: u, password: p });
};

window.confirmStats = () => {
    // Pega os atributos temporários editados na janela
    const newAttrs = getTempAttributes(); 
    socket.emit('distribute_points', newAttrs);
    toggleStatusWindow(); // Fecha a janela
};

// --- AUDIO ---
function playBGM(file) {
    if (bgmAudio.src.includes(file)) return; 
    bgmAudio.src = file;
    bgmAudio.play().catch(e => console.log("Audio: Clique necessário"));
}
window.addEventListener('click', () => {
    if(UI.loginScreen.style.display !== 'none') playBGM('assets/bgm1.webm');
}, { once: true });

// --- SOCKET EVENTS (AUTH) ---
socket.on('register_success', (msg) => { alert(msg); toggleForms(); });
socket.on('login_error', (msg) => showAuthError(msg, 'login'));

socket.on('login_success', (data) => {
    playBGM('assets/bgm2.webm');
    showGameInterface(); // Esconde login, mostra HUD/Chat
    
    myUsername = data.playerData.username; 
    
    // Carrega dados RPG
    if(data.playerData.stats) myStats = data.playerData.stats;
    myLevel = data.playerData.level || 1;
    myXp = data.playerData.xp || 0;
    myNextXp = data.playerData.nextLevelXp || 100;
    myAttributes = data.playerData.attributes || { str:5, agi:5, int:5, vit:5 };
    myPoints = data.playerData.points || 0;

    initEngine(); 
    updateHUD(myStats, myLevel, myXp, myNextXp); 
    loadMap(data.mapConfig, data.playerData, data.mapPlayers, data.mapMonsters);
});

// --- SOCKET EVENTS (GAMEPLAY) ---
socket.on('map_changed', (data) => { 
    currentTargetId = null; // Limpa o ID
    if(targetRing) targetRing.visible = false;
    loadMap(data.mapConfig, data.playerData, data.mapPlayers, data.mapMonsters); 
});

socket.on('update_stats', (data) => {
    myStats = data.stats;
    myLevel = data.level;
    myXp = data.xp;
    myNextXp = data.nextLevelXp;
    myAttributes = data.attributes;
    myPoints = data.points;
    
    updateHUD(myStats, myLevel, myXp, myNextXp);
    
    // Se a janela de status estiver aberta, atualizamos os pontos (mas cuidado para não resetar a edição do player)
    // Aqui optamos por atualizar apenas o display de pontos para simplificar
    if(document.getElementById('st-points')) {
        document.getElementById('st-points').textContent = myPoints;
    }
});

socket.on('player_joined', (data) => { if(data.id !== socket.id) addOtherPlayer(data); });
socket.on('player_left', (id) => { if(otherPlayers[id]) { scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });

socket.on('player_moved', d => {
    if(d.id === socket.id) return;
    if(otherPlayers[d.id]) {
        otherPlayers[d.id].userData.targetPos = new THREE.Vector3(d.position.x, d.position.y, d.position.z);
        otherPlayers[d.id].userData.targetRot = d.rotation;
        if(otherPlayers[d.id].userData.current !== d.animation) playAnim(otherPlayers[d.id], d.animation);
    }
});

socket.on('monsters_update', (pack) => {
    if(isMapLoading) return;
    const serverIds = new Set(pack.map(d => d.id));
    Object.keys(monsters).forEach(localId => {
        if(!serverIds.has(localId)) { scene.remove(monsters[localId]); delete monsters[localId]; }
    });
    pack.forEach(d => {
        if(monsters[d.id]) {
            monsters[d.id].userData.targetPos = new THREE.Vector3(d.position.x, d.position.y, d.position.z);
            monsters[d.id].userData.targetRot = d.rotation;
            if(monsters[d.id].userData.current !== d.animation) playAnim(monsters[d.id], d.animation);
        } else { addMonster(d); }
    });
});

socket.on('monster_dead', (id) => { 
    // Se o monstro que morreu é o meu alvo
    if(currentTargetId === id) {
        currentTargetId = null; // Limpa o alvo
        if(targetRing) targetRing.visible = false;
    }
    if(monsters[id]) { scene.remove(monsters[id]); delete monsters[id]; } 
});

socket.on('chat_message', (data) => {
    addLogMessage(data.username, data.message, data.type);
    let target = (data.id === socket.id) ? myPlayer : otherPlayers[data.id];
    if(target) createChatBubble(target, data.message);
});

socket.on('damage_dealt', (d) => {
    let pos = null;
    const color = d.isMonster ? '#ffff00' : '#ff0000'; 

    if (d.targetId === socket.id) {
        if (myPlayer) pos = myPlayer.position.clone();
    } else if (monsters[d.targetId]) {
        pos = monsters[d.targetId].position.clone();
    } else if (otherPlayers[d.targetId]) {
        pos = otherPlayers[d.targetId].position.clone();
    }

    if (pos) showDamageNumber(d.damage, pos, color);
});

// --- ENGINE & INITIALIZATION ---
function initEngine() {
    if (renderer) return;

    clock = new THREE.Clock();
    scene = new THREE.Scene(); 
    scene.background = new THREE.Color(0x87CEEB); 

    environmentLayer = new THREE.Group();
    scene.add(environmentLayer);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap; 

    UI.canvasContainer.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.4);
    dir.position.set(20, 50, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 100;
    const d = 30;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    scene.add(dir);
    targetRing = createTargetIndicator(); // <--- CRIA O ANEL

    // CONFIGURA INPUTS (Passando Callbacks)
    setupInputs(
        // OnChatToggle
        (active) => {
            toggleChatFocus(active);
            if(!active && UI.chatInput.value.trim() !== "") {
                socket.emit('chat_message', UI.chatInput.value.trim());
                UI.chatInput.value = "";
            }
            // Resetar animação se entrar no chat
            if(active && myPlayer) {
                playAnim(myPlayer, 'IDLE');
                socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: 'IDLE' });
            }
        },
        // OnAttack
        () => {
             if(getIsChatActive() || isAttacking || isSitting || !myPlayer) return;
             
             // 1. Tenta achar um alvo NOVO
             const foundTargetMesh = findBestTarget();
             
             // 2. Se achou um alvo novo, atualiza o ID Grudento
             if (foundTargetMesh) {
                 currentTargetId = foundTargetMesh.userData.id;
             }

             // 3. Tenta recuperar o objeto real usando o ID (novo ou antigo)
             const targetObj = monsters[currentTargetId] || otherPlayers[currentTargetId];

             // 4. Lógica de Rotação e Anel
             if (targetObj) {
                 // Calcula a distância real até o alvo selecionado
                 const dist = myPlayer.position.distanceTo(targetObj.position);
                 
                 // --- CORREÇÃO AQUI ---
                 // Define uma distância máxima para o "Auto-Aim" (ex: 3 metros)
                 // Se estiver mais longe que isso, o boneco ataca para frente (onde a câmera aponta) sem virar.
                 const MAX_AUTO_TURN_DIST = 1.5; 

                 if (dist <= MAX_AUTO_TURN_DIST) {
                     const dx = targetObj.position.x - myPlayer.position.x;
                     const dz = targetObj.position.z - myPlayer.position.z;
                     const angle = Math.atan2(dx, dz);
                     myPlayer.rotation.y = angle;
                 }
                 // ---------------------
                 
                 // O anel continua aparecendo no alvo, para você saber que ele ainda é o selecionado
                 targetRing.visible = true;
                 targetRing.position.set(targetObj.position.x, 0.05, targetObj.position.z);
             }

             isAttacking = true;
             playAnim(myPlayer, 'ATTACK');
             
             socket.emit('player_update', { 
                 position: myPlayer.position, 
                 rotation: myPlayer.rotation.y, 
                 animation: 'ATTACK' 
             });
             
             socket.emit('attack_request');
             
             setTimeout(() => { 
                 isAttacking = false; 
                 if(!isSitting) playAnim(myPlayer, 'IDLE'); 
             }, 800);
        },
        // OnSit
        () => {
            if(getIsChatActive() || isAttacking || !myPlayer) return;
            isSitting = !isSitting;
            const anim = isSitting ? 'SIT' : 'IDLE';
            playAnim(myPlayer, anim);
            socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: anim });
        }
    );

    window.addEventListener('resize', () => { 
        if(!camera || !renderer) return;
        camera.aspect = window.innerWidth/window.innerHeight; 
        camera.updateProjectionMatrix(); 
        renderer.setSize(window.innerWidth, window.innerHeight); 
    });

    animate();
}

function loadMap(mapConfig, myData, players, mobs) {
    isMapLoading = true;
    currentMapConfig = mapConfig; 
    
    UI.loadingScreen.style.display = 'flex';
    UI.mapName.textContent = mapConfig.id.toUpperCase();

    // Limpeza
    environmentLayer.clear(); 
    Object.keys(otherPlayers).forEach(id => { scene.remove(otherPlayers[id]); delete otherPlayers[id]; });
    Object.keys(monsters).forEach(id => { scene.remove(monsters[id]); delete monsters[id]; });
    mapProps.forEach(p => scene.remove(p)); mapProps = [];
    
    const loader = new THREE.GLTFLoader();
    let toLoad = 1; 

    if(!myPlayer && !isPlayerLoading) { toLoad++; isPlayerLoading = true; }

    // Cache de monstros
    if(!monsterTemplates['monster1']) { toLoad++; loader.load('assets/monster1.glb', g=>{monsterTemplates['monster1']=g; checkDone();}); }
    if(!monsterTemplates['monster2']) { toLoad++; loader.load('assets/monster2.glb', g=>{monsterTemplates['monster2']=g; checkDone();}); }

    loader.load('assets/' + mapConfig.asset, gltf => {
        const model = gltf.scene;
        model.traverse(c => { 
            if(c.isMesh) { 
                c.receiveShadow = true; 
                c.castShadow = true;   
                if(c.material) c.material.dithering = false;
            } 
        });
        const off = mapConfig.offset || { x: 0, y: 0, z: 0 };
        model.position.set(off.x, off.y, off.z);
        environmentLayer.add(model); 
        checkDone();
    });

    if(!myPlayer && isPlayerLoading) {
        loader.load('assets/heroi1.glb', gltf => {
            const mesh = gltf.scene;
            mesh.scale.set(0.6, 0.6, 0.6);
            mesh.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; } });
            setupAnimations(mesh, gltf.animations);
            myPlayer = mesh;
            scene.add(myPlayer);
            checkDone();
        });
    } else if(myPlayer) {
        myPlayer.position.set(myData.position.x, myData.position.y, myData.position.z);
        scene.add(myPlayer); 
    }

    function checkDone() {
        toLoad--;
        if(toLoad <= 0) {
            isPlayerLoading = false;
            finalizeMapLoad(myData, players, mobs);
        }
    }
}

function finalizeMapLoad(myData, players, mobs) {
    if(myPlayer) {
        myPlayer.position.set(myData.position.x, myData.position.y, myData.position.z);
        isSitting = false; isAttacking = false;
        playAnim(myPlayer, 'IDLE');
    }
    
    if(currentMapConfig.portals) {
        const geo = new THREE.CylinderGeometry(1, 1, 0.1, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 });
        currentMapConfig.portals.forEach(p => {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(p.x, 0.1, p.z);
            environmentLayer.add(mesh);
        });
    }
    
    Object.values(players).forEach(p => { if(p.id !== socket.id) addOtherPlayer(p); });
    Object.values(mobs).forEach(m => addMonster(m));
    
    isMapLoading = false;
    setTimeout(() => UI.loadingScreen.style.display = 'none', 500);
}

// --- ENTIDADES & ANIMAÇÃO ---
function setupAnimations(mesh, clips) {
    const mixer = new THREE.AnimationMixer(mesh);
    mesh.userData.mixer = mixer;
    mesh.userData.actions = {};

    clips.forEach(clip => {
        const action = mixer.clipAction(clip);
        const name = clip.name.toUpperCase();
        if (name === 'WALK') action.timeScale = CONFIG.animSpeedWalk;
        if (name === 'RUN') action.timeScale = CONFIG.animSpeedRun;
        if (name === 'ATTACK') { action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; }
        mesh.userData.actions[name] = action;
    });

    mesh.userData.play = (name) => {
        if(mesh.userData.current === name && name !== 'ATTACK') return;
        const act = mesh.userData.actions[name] || mesh.userData.actions['IDLE'];
        if(!act) return;
        if(mesh.userData.current && mesh.userData.actions[mesh.userData.current]) {
            mesh.userData.actions[mesh.userData.current].fadeOut(0.2);
        }
        act.reset().fadeIn(0.2).play();
        mesh.userData.current = name;
    };
}

function playAnim(mesh, name) { if(mesh && mesh.userData.play) mesh.userData.play(name); }

function addOtherPlayer(data) {
    if(data.id === socket.id || data.username === myUsername || otherPlayers[data.id]) return;
    const loader = new THREE.GLTFLoader();
    loader.load('assets/heroi1.glb', gltf => {
        const mesh = gltf.scene;
        // --- CORREÇÃO IMPORTANTE AQUI ---
        mesh.userData.id = data.id; // Salva o ID real do jogo (ex: socket id)
        // --------------------------------
        mesh.scale.set(0.6, 0.6, 0.6);
        mesh.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; } });  
        setupAnimations(mesh, gltf.animations);
        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.rotation.y = data.rotation;
        const sprite = createTextSprite(data.username, 'white');
        sprite.position.y = 2.2;
        mesh.add(sprite);
        scene.add(mesh);
        otherPlayers[data.id] = mesh;
        mesh.userData.targetPos = mesh.position.clone();
        mesh.userData.targetRot = data.rotation;
        playAnim(mesh, data.animation || 'IDLE');
    });
}

function addMonster(data) {
    if(monsters[data.id]) return;
    const tpl = monsterTemplates[data.type === 'slime' ? 'monster1' : 'monster2'];
    if(!tpl) return;
    const mesh = tpl.scene.clone();
    // --- CORREÇÃO IMPORTANTE AQUI ---
    mesh.userData.id = data.id; // Salva o ID real do jogo (ex: "mob_0")
    // --------------------------------
    mesh.scale.set(0.4, 0.4, 0.4);
    mesh.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; } });  
    setupAnimations(mesh, tpl.animations);
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.rotation.y = data.rotation;
    scene.add(mesh);
    monsters[data.id] = mesh;
    mesh.userData.targetPos = mesh.position.clone();
    mesh.userData.targetRot = data.rotation;
}

// --- VISUAL FX ---
function createTextSprite(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d'); ctx.font = "bold 32px Arial"; ctx.fillStyle = color; ctx.textAlign = "center";
    ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText(text, 128, 40); ctx.fillText(text, 128, 40);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
    s.scale.set(2, 0.5, 1); return s;
}

// public/game.js

function createChatBubble(mesh, text) {
    if(mesh.userData.activeBubble) { 
        mesh.remove(mesh.userData.activeBubble); 
        mesh.userData.activeBubble = null; 
    }

    const canvas = document.createElement('canvas'); 
    const ctx = canvas.getContext('2d');
    const fontSize = 18; 
    const maxW = 350; 
    const pad = 15;

    ctx.font = `bold ${fontSize}px Arial`;

    // --- NOVO ALGORITMO DE QUEBRA DE PALAVRAS ---
    const rawWords = text.split(' ');
    const processedWords = [];

    // 1. Processa palavras gigantes (tipo "aaaaaaaa...")
    for (let w of rawWords) {
        const width = ctx.measureText(w).width;
        if (width <= maxW) {
            processedWords.push(w);
        } else {
            // Palavra é maior que o balão inteiro! Vamos fatiar.
            let temp = "";
            for (let char of w) {
                // Testa se a parte atual + próxima letra + hífen cabe
                if (ctx.measureText(temp + char + "-").width < maxW) {
                    temp += char;
                } else {
                    // Não cabe mais, fecha essa parte com hífen e começa outra
                    processedWords.push(temp + "-");
                    temp = char;
                }
            }
            if (temp) processedWords.push(temp); // Adiciona o resto que sobrou
        }
    }

    // 2. Monta as linhas finais combinando as palavras processadas
    let lines = [];
    let currentLine = processedWords[0];

    for (let i = 1; i < processedWords.length; i++) {
        const word = processedWords[i];
        const testLine = currentLine + " " + word;
        
        // Se a linha combinada couber, junta. Se não, pula pra próxima.
        if (ctx.measureText(testLine).width < maxW) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    // ---------------------------------------------

    // Cálculo do tamanho final do balão baseado nas linhas geradas
    let realWidth = 0;
    lines.forEach(line => { 
        const metrics = ctx.measureText(line); 
        if (metrics.width > realWidth) realWidth = metrics.width; 
    });

    const w = realWidth + (pad * 2); 
    const h = (lines.length * 24) + (pad * 2);

    canvas.width = w; 
    canvas.height = h;

    // Redesenha fundo e texto (pois redimensionar o canvas limpa ele)
    ctx.fillStyle = "rgba(0,0,0,0.6)"; 
    ctx.fillRect(0,0,w,h);
    
    ctx.font = `bold ${fontSize}px Arial`; 
    ctx.fillStyle = "white"; 
    ctx.textAlign = "center"; 
    ctx.textBaseline = "top";

    lines.forEach((l, i) => ctx.fillText(l, w/2, pad + (i*24)));
    
    const texture = new THREE.CanvasTexture(canvas); 
    texture.minFilter = THREE.LinearFilter;
    
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(w * 0.015, h * 0.015, 1); 
    sprite.position.set(0, 3.2, 0); 
    sprite.renderOrder = 999;
    
    mesh.add(sprite); 
    mesh.userData.activeBubble = sprite;
    
    setTimeout(() => { 
        if(mesh.userData.activeBubble===sprite) { 
            mesh.remove(sprite); 
            mesh.userData.activeBubble=null; 
        } 
    }, 6000);
}

function showDamageNumber(dmg, pos, colorStr) {
    if(!scene || !camera) return;
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = "bold 40px Arial"; ctx.fillStyle = colorStr; ctx.textAlign = "center";
    ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.lineWidth = 3;
    ctx.strokeText("-" + dmg, 128, 70); ctx.fillText("-" + dmg, 128, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(pos.x, pos.y + 1.8, pos.z); 
    sprite.scale.set(3, 1.5, 1); sprite.renderOrder = 1000;
    scene.add(sprite);
    let steps = 0; const maxSteps = 40; 
    const interval = setInterval(() => {
        if (!sprite || !scene) { clearInterval(interval); return; }
        sprite.position.y += 0.03; material.opacity -= 0.025; steps++;
        if (steps >= maxSteps || material.opacity <= 0) {
            clearInterval(interval);
            if(scene) scene.remove(sprite); if(texture) texture.dispose(); if(material) material.dispose();
        }
    }, 30);
}

// --- COLISÃO & LOOP ---
function checkCollision(position, direction, distance) {
    if(!environmentLayer) return false;
    tempOrigin.copy(position).y += 0.5;
    raycaster.set(tempOrigin, direction);
    const intersects = raycaster.intersectObjects(environmentLayer.children, true);
    return (intersects.length > 0 && intersects[0].distance < distance);
}

function createTargetIndicator() {
    // Geometria de anel: raio interno, raio externo, segmentos
    const geo = new THREE.RingGeometry(0.4, 0.5, 32); 
    const mat = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, 
        transparent: true, 
        opacity: 0.6, 
        side: THREE.DoubleSide // Para ver de cima e de baixo (caso o chão seja desnivelado)
    });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Deita o anel no chão (rotação X de 90 graus)
    mesh.rotation.x = -Math.PI / 2; 
    mesh.position.set(0, 0.05, 0); // Levemente acima do chão para não bugar (Z-fighting)
    mesh.visible = false; // Começa invisível
    
    scene.add(mesh);
    return mesh;
}

function findBestTarget() {
    if (!myPlayer) return null;
    
    const ATTACK_RANGE = 2.0; // Distância visual para selecionar (pode ser um pouco maior que a do server)
    let best = null;
    let minDist = Infinity;

    // 1. Procura monstros
    Object.values(monsters).forEach(m => {
        const dist = m.position.distanceTo(myPlayer.position);
        if (dist <= ATTACK_RANGE && dist < minDist) {
            best = m;
            minDist = dist;
        }
    });

    // 2. Procura players (apenas se for mapa PVP)
    // Dica: Para simplificar aqui no cliente, vamos permitir mirar em players sempre,
    // mas o dano só vai contar se o servidor deixar.
    if (!best) {
        Object.values(otherPlayers).forEach(p => {
            const dist = p.position.distanceTo(myPlayer.position);
            if (dist <= ATTACK_RANGE && dist < minDist) {
                best = p;
                minDist = dist;
            }
        });
    }
    
    return best;
}

function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    frameCount++;
    if (now - lastFpsTime >= 1000) {
        if(UI.dbgFps) {
            UI.dbgFps.textContent = frameCount;
            const fps = parseInt(UI.dbgFps.textContent);
            UI.dbgFps.style.color = fps >= 50 ? '#00ff00' : (fps >= 30 ? '#ffff00' : '#ff0000');
        }
        frameCount = 0; lastFpsTime = now;
    }
    const delta = clock.getDelta();

    if(myPlayer && !isMapLoading) {
        if(myPlayer.userData.mixer) myPlayer.userData.mixer.update(delta);
        
        updateDebug(currentMapConfig ? currentMapConfig.id : '', myPlayer.position, Object.keys(otherPlayers).length + 1);
        
        const isChatActive = getIsChatActive();

        if(!isChatActive && !isSitting && !isAttacking) { 
            let move = false;
            tempVector.set(0, 0, 0);

            if(keys['w']) tempVector.z -= 1; if(keys['s']) tempVector.z += 1;
            if(keys['a']) tempVector.x -= 1; if(keys['d']) tempVector.x += 1;

            if(tempVector.lengthSq() > 0) {
                tempVector.normalize();
                const isRunning = keys['shift']; 
                const speed = isRunning ? CONFIG.runSpeed : CONFIG.moveSpeed;
                const moveDistance = speed * delta; 
                const worldDir = tempVector.clone(); 
                
                if(!checkCollision(myPlayer.position, worldDir, 0.8)) {
                    const nextX = myPlayer.position.x + tempVector.x * moveDistance;
                    const nextZ = myPlayer.position.z + tempVector.z * moveDistance;
                    const halfMap = currentMapConfig.mapSize / 2;
                    const maxLimit = halfMap - CONFIG.mapPadding; 
                    const minLimit = -(halfMap - CONFIG.mapPadding) - 1.0; 

                    if (nextX > minLimit && nextX < maxLimit && nextZ > minLimit && nextZ < maxLimit) {
                        myPlayer.position.x = nextX;
                        myPlayer.position.z = nextZ;
                        move = true;
                    }
                }

                const targetRot = Math.atan2(tempVector.x, tempVector.z);
                let diff = targetRot - myPlayer.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                myPlayer.rotation.y += diff * 0.2;

                playAnim(myPlayer, isRunning ? 'RUN' : 'WALK'); 
            } else {
                if(myPlayer.userData.current !== 'ATTACK' && myPlayer.userData.current !== 'SIT') {
                    playAnim(myPlayer, 'IDLE');
                }
            }

            if(move || now - lastPacketTime > 50) {
                const currentAnim = myPlayer.userData.current || 'IDLE';
                socket.emit('player_update', { 
                    position: myPlayer.position, rotation: myPlayer.rotation.y, animation: currentAnim 
                });
                lastPacketTime = now;
            }
        }
        
        tempOrigin.copy(myPlayer.position).add(new THREE.Vector3(0, 5, 8)); 
        camera.position.lerp(tempOrigin, 0.1);
        camera.lookAt(myPlayer.position.x, myPlayer.position.y + 1, myPlayer.position.z);
    }

    Object.values(otherPlayers).forEach(p => {
        if(p.userData.targetPos) p.position.lerp(p.userData.targetPos, CONFIG.lerpFactor);
        if(p.userData.targetRot !== undefined) {
             let diff = p.userData.targetRot - p.rotation.y;
             while (diff > Math.PI) diff -= Math.PI * 2;
             while (diff < -Math.PI) diff += Math.PI * 2;
             p.rotation.y += diff * CONFIG.lerpFactor;
        }
        if(p.userData.mixer) p.userData.mixer.update(delta);
    });

    Object.values(monsters).forEach(m => {
        if(m.userData.targetPos) {
            const dist = m.position.distanceTo(m.userData.targetPos);
            if(dist > 5.0) m.position.copy(m.userData.targetPos);
            else m.position.lerp(m.userData.targetPos, CONFIG.lerpFactor);
        }
        if(m.userData.targetRot !== undefined) m.rotation.y = m.userData.targetRot;
        if(m.userData.mixer) m.userData.mixer.update(delta);
    });

    renderer.render(scene, camera);
    // ATUALIZAÇÃO DO ANEL
    // Recupera o objeto usando o ID salvo
    const activeTarget = monsters[currentTargetId] || otherPlayers[currentTargetId];

    if (targetRing && activeTarget) {
        // Se o alvo existe na lista de monstros ou players
        targetRing.visible = true;
        targetRing.position.lerp(activeTarget.position, 0.2);
        targetRing.position.y = 0.05;
    } else {
        // Se não tem ID, ou se o ID não está mais na lista (morreu/saiu)
        if(targetRing) targetRing.visible = false;
        
        // Opcional: Se o monstro sumiu da lista, limpamos o ID para não ficar processando
        if (!activeTarget) currentTargetId = null;
    }
}