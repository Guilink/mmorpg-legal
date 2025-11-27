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
    getTempAttributes,
    updateLoadingBar // Necessário para enviar os dados alterados
} from './js/UIManager.js';
import { keys, setupInputs, getIsChatActive, setChatActive } from './js/InputManager.js';
import { 
    FadeManager, 
    createChatBubble, 
    showDamageNumber, 
    createTargetIndicator, 
    createTextSprite 
} from './js/VFX.js';

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
let globalMonsterTypes = {};
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
let attackTimer = 0; // Controla o tempo restante da animação de ataque
let isSitting = false;   
let lastAttackTime = 0;
const ATTACK_COOLDOWN = 800; //ms
let currentMapConfig = null;
let lastPacketTime = 0;
let totalOnline = 1;
const myMsgHistory = [];
const MAX_HISTORY = 10; // Guarda as ultimas 10 mensagens
let historyIndex = -1;
let lastSitTime = 0;

// Dados RPG Locais
let myStats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };
let myLevel = 1, myXp = 0, myNextXp = 100, myPoints = 0;
let myAttributes = { str: 5, agi: 5, int: 5, vit: 5 };

// --- SISTEMA DE FADE (VISUAL) ---
const fadingMeshes = []; // Lista de objetos sendo animados (fade in ou out)

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
    globalMonsterTypes = data.monsterTypes || {};

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

socket.on('player_left', (id) => { 
    if(otherPlayers[id]) { 
        // --- CORREÇÃO AQUI: Passar 'scene' como 2º argumento ---
        FadeManager.fadeOutAndRemove(otherPlayers[id], scene); 
        
        delete otherPlayers[id]; 
    } 
});

socket.on('player_moved', d => {
    if(d.id === socket.id) return;
    
    // Se o player ainda não existe, crie-o (segurança)
    if(!otherPlayers[d.id]) {
        addOtherPlayer(d);
        return;
    }

    const p = otherPlayers[d.id];
    
    // 1. Atualiza Posição Alvo
    p.userData.targetPos.set(d.position.x, d.position.y, d.position.z);
    
    // 2. Atualiza Rotação Alvo (Usando Quaternion para suavidade absoluta)
    // Criamos um quaternion baseada na rotação Y enviada pelo server
    const targetEuler = new THREE.Euler(0, d.rotation, 0, 'XYZ');
    p.userData.targetQuat.setFromEuler(targetEuler);

    // 3. Atualiza Estado de Animação do Servidor (Intenção)
    p.userData.serverAnimation = d.animation; 
    
    // 4. Teletransporte de emergência
    // Se o boneco estiver muito longe (> 5 metros), teletransporta instantaneamente
    // para evitar que ele atravesse paredes correndo muito rápido para alcançar o alvo.
    if (p.position.distanceTo(p.userData.targetPos) > 5.0) {
        p.position.copy(p.userData.targetPos);
        p.quaternion.copy(p.userData.targetQuat);
    }
});

socket.on('monsters_update', (pack) => {
    if(isMapLoading) return;

    const now = Date.now();
    const serverIds = new Set();

    // 1. Atualiza ou Cria Monstros baseados no pacote do servidor
    pack.forEach(d => {
        serverIds.add(d.id);

        if(monsters[d.id]) {
            const mob = monsters[d.id];
            
            // OTIMIZAÇÃO: Usamos .set() para reutilizar o Vetor existente
            // em vez de criar um new THREE.Vector3() a cada frame (reduz lixo de memória)
            if(mob.userData.targetPos) {
                mob.userData.targetPos.set(d.position.x, d.position.y, d.position.z);
            }
            
            mob.userData.targetRot = d.rotation;
            
            // Atualiza Animação apenas se mudou
            if(mob.userData.current !== d.animation) {
                playAnim(mob, d.animation);
            }

            // Atualiza HP (útil para lógica interna ou barras de vida futuras)
            mob.userData.hp = d.hp;

            // CRÍTICO: Marca o momento exato (timestamp) que este monstro foi visto
            mob.userData.lastSeen = now;

        } else { 
            // Se o monstro não existe no cliente, cria ele
            addMonster(d);
            
            // Marca como visto imediatamente após criar para não ser deletado no passo 2
            if(monsters[d.id]) {
                monsters[d.id].userData.lastSeen = now;
            }
        }
    });

    // 2. Limpeza Suave ("Soft Garbage Collection")
    // Em vez de deletar imediatamente quem não veio no pacote (o que causa piscadas),
    // nós damos uma tolerância de tempo.
    const TOLERANCE = 2000; // 2 segundos

    Object.keys(monsters).forEach(localId => {
        const m = monsters[localId];
        
        // Se o ID local NÃO estava no pacote atual do servidor...
        if(!serverIds.has(localId)) {
            
            // Verificamos há quanto tempo ele não é atualizado.
            // Se faz mais de 2 segundos que não ouvimos falar dele, removemos.
            // (Significa que ele saiu da área de visão ou o servidor parou de enviar)
            if (m.userData.lastSeen && (now - m.userData.lastSeen > TOLERANCE)) {
                scene.remove(m); 
                delete monsters[localId];
                
                // Se esse monstro era nosso alvo, limpamos o alvo
                if(currentTargetId === localId) {
                    currentTargetId = null;
                    if(targetRing) targetRing.visible = false;
                }
            }
            // Se faz menos de 2s, mantemos ele na tela onde estava.
            // Isso cobre "lags" de rede onde 1 ou 2 pacotes se perdem.
        }
    });
});

socket.on('monster_dead', (id) => { 
    if(currentTargetId === id) {
        currentTargetId = null; 
        if(targetRing) targetRing.visible = false;
    }
    if(monsters[id]) { 
        // --- CORREÇÃO AQUI: Passar 'scene' como 2º argumento ---
        FadeManager.fadeOutAndRemove(monsters[id], scene); 
        
        delete monsters[id]; 
    } 
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

     if (pos) {
        // --- CORREÇÃO AQUI: Passar 'camera' como 4º argumento ---
        showDamageNumber(d.damage, pos, color, camera); 
    }
});

// ... Socket Events ...
socket.on('server_stats', (data) => {
    totalOnline = data.total;
});

// --- ENGINE & INITIALIZATION ---
function initEngine() {
    if (renderer) return;

    clock = new THREE.Clock();
    
    // 1. CRIA A CENA PRIMEIRO
    scene = new THREE.Scene(); 
    const skyColor = 0x87CEEB; 
    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(skyColor, 5, 35);

    environmentLayer = new THREE.Group();
    scene.add(environmentLayer);

    // 2. CONFIGURA CÂMERA E RENDERER
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap; 

    UI.canvasContainer.appendChild(renderer.domElement);

    // 3. LUZES
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(20, 50, 20);
    dir.castShadow = false;
    dir.shadow.mapSize.width = 1024; // Sombra otimizada
    dir.shadow.mapSize.height = 1024;
    dir.shadow.bias = -0.0020;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 100;
    const d = 30;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    scene.add(dir);

    // 4. AGORA SIM: CRIA O ANEL (A cena já existe aqui!)
    // --- ESTA LINHA CAUSAVA O ERRO SE ESTIVESSE NO TOPO ---
    targetRing = createTargetIndicator(scene); 
    // ------------------------------------------------------

    // CONFIGURA INPUTS (Chat e Movimento)
    const updateChatState = (isActive) => {
        setChatActive(isActive);   
        toggleChatFocus(isActive); 
        
        if (isActive) {
            keys['w'] = keys['a'] = keys['s'] = keys['d'] = false;
            if (myPlayer) {
                playAnim(myPlayer, 'IDLE');
                socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: 'IDLE' });
            }
        } else {
            historyIndex = -1;
        }
    };

    UI.chatInput.addEventListener('focus', () => updateChatState(true));
    UI.chatInput.addEventListener('blur', () => updateChatState(false));

    UI.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault(); 
            UI.chatInput.blur(); 
            return;
        }
        const isUp = (e.key === 'ArrowUp');
        const isDown = (e.key === 'ArrowDown');
        if (isUp || isDown) {
            if (e.shiftKey) return; 
            e.preventDefault(); 
            if (myMsgHistory.length === 0) return;

            if (isUp) {
                if (historyIndex === -1) historyIndex = myMsgHistory.length - 1;
                else if (historyIndex > 0) historyIndex--;
                UI.chatInput.value = myMsgHistory[historyIndex];
            } 
            else if (isDown) {
                if (historyIndex === -1) return; 
                historyIndex++; 
                if (historyIndex >= myMsgHistory.length) {
                    historyIndex = -1;
                    UI.chatInput.value = "";
                } else {
                    UI.chatInput.value = myMsgHistory[historyIndex];
                }
            }
        }
    });

    setupInputs(
        () => {
            if (document.activeElement === UI.chatInput) {
                const txt = UI.chatInput.value.trim();
                if (txt !== "") {
                    socket.emit('chat_message', txt);
                    myMsgHistory.push(txt);
                    if (myMsgHistory.length > MAX_HISTORY) myMsgHistory.shift();
                    UI.chatInput.value = "";
                    historyIndex = -1;
                } else {
                    UI.chatInput.blur(); 
                }
            } else {
                UI.chatInput.focus(); 
            }
        },
        () => {
            if(getIsChatActive() || isAttacking || !myPlayer) return;
            const now = Date.now();
            if (now - lastSitTime < 300) return; 
            lastSitTime = now;
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
    
    // --- UI DE CARREGAMENTO ---
    UI.loadingScreen.style.display = 'flex';
    UI.mapName.textContent = mapConfig.id.toUpperCase();
    
    // Reseta a barra para 0% ao começar
    updateLoadingBar(0); 

    // --- LIMPEZA DE CENA (IMPORTANTE) ---
    environmentLayer.clear(); 
    
    // Remove jogadores antigos visualmente e da memória
    Object.keys(otherPlayers).forEach(id => { 
        scene.remove(otherPlayers[id]); 
        delete otherPlayers[id]; 
    });
    otherPlayers = {}; 

    // Remove monstros antigos
    Object.keys(monsters).forEach(id => { 
        scene.remove(monsters[id]); 
        delete monsters[id]; 
    });
    monsters = {}; 

    // Remove props antigos (se houver)
    mapProps.forEach(p => scene.remove(p)); 
    mapProps = [];
    // ----------------------------------
    
    const loader = new THREE.GLTFLoader();
    
    // Contador de assets para saber quando tudo terminou
    // Começa com 1 (o Mapa)
    let toLoad = 1; 

    // Se o player ainda não existe, adiciona na fila de carregamento
    if(!myPlayer && !isPlayerLoading) { 
        toLoad++; 
        isPlayerLoading = true; 
    }

// --- CACHE DE MODELOS DE MONSTROS (Otimizado) ---
    // Lista de monstros que precisamos carregar (baseado no mapeamento do server)
    // 1. Descobre quais modelos únicos existem no jogo inteiro (ou poderia filtrar só pelo mapa)
    const uniqueModels = new Set();
    Object.values(globalMonsterTypes).forEach(conf => {
        if(conf.model) uniqueModels.add(conf.model);
    });

    // 2. Loop automático para carregar os arquivos GLB necessários
    uniqueModels.forEach(modelName => {
        // Se ainda não carregamos este modelo...
        if(!monsterTemplates[modelName]) {
            toLoad++; // Aumenta contador de loading
            
            // O caminho agora é montado dinamicamente: assets/ + nome + .glb
            loader.load(`assets/${modelName}.glb`, g => {
                monsterTemplates[modelName] = g;
                checkDone();
            }, undefined, (err) => {
                console.error(`Erro ao carregar monstro: ${modelName}`, err);
                checkDone(); // Chama done mesmo com erro para não travar o load
            });
        }
    });

    // --- CARREGAMENTO DO MAPA (COM BARRA DE PROGRESSO) ---
    loader.load(
        'assets/' + mapConfig.asset, 
        
        // 1. SUCESSO (onLoad)
        (gltf) => {
            const model = gltf.scene;
            
            model.traverse(c => { 
                if(c.isMesh) { 
                    c.receiveShadow = true; 
                    c.castShadow = true;   
                    
                    // --- CORREÇÃO DE TRANSPARÊNCIA/RAIO-X ---
                    if(c.material) {
                        c.material.transparent = false; // Força objeto sólido
                        c.material.alphaTest = 0.5;     // Recorte correto para grades/folhas
                        c.material.depthWrite = true;   // Escreve no buffer de profundidade
                        c.material.side = THREE.DoubleSide; // Renderiza os dois lados da parede
                        c.material.dithering = false;
                    }
                    // -----------------------------------------
                } 
            });

            const off = mapConfig.offset || { x: 0, y: 0, z: 0 };
            model.position.set(off.x, off.y, off.z);
            environmentLayer.add(model); 
            
            // Garante 100% visual no final
            updateLoadingBar(100);
            checkDone();
        },

        // 2. PROGRESSO (onProgress)
        (xhr) => {
            if (xhr.lengthComputable) {
                const percentComplete = (xhr.loaded / xhr.total) * 100;
                // Atualiza a barra na UI
                updateLoadingBar(percentComplete);
            }
        },

        // 3. ERRO (onError)
        (error) => {
            console.error('Erro fatal ao carregar mapa:', error);
            UI.mapName.textContent = "ERRO NO DOWNLOAD";
        }
    );

    // --- CARREGAMENTO DO JOGADOR (SE NECESSÁRIO) ---
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
        // Se o player já existe, apenas reposiciona
        myPlayer.position.set(myData.position.x, myData.position.y, myData.position.z);
        scene.add(myPlayer); 
    }

    // Função interna para finalizar quando TODOS os arquivos chegarem
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
    // 1. Prevenção de Duplicidade: Se já existe, remove o antigo primeiro
    if (otherPlayers[data.id]) {
        scene.remove(otherPlayers[data.id]);
        delete otherPlayers[data.id];
    }
    
    // Não adiciona a si mesmo
    if(data.id === socket.id) return; 

    // Se o nome vier undefined, usa um placeholder
    const nameToShow = data.username || "Desconhecido";

    const loader = new THREE.GLTFLoader();
    loader.load('assets/heroi1.glb', gltf => {
        // Verifica de novo se o player não foi adicionado enquanto carregava (segurança async)
        if(otherPlayers[data.id]) {
             scene.remove(otherPlayers[data.id]);
        }

        const mesh = gltf.scene;
        mesh.userData.id = data.id; 

        // Configuração de Interpolação
        mesh.userData.targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        mesh.userData.targetQuat = new THREE.Quaternion();
        mesh.userData.targetQuat.setFromEuler(new THREE.Euler(0, data.rotation, 0));
        
        mesh.userData.serverAnimation = data.animation || 'IDLE';
        mesh.userData.currentAnimation = '';

        mesh.scale.set(0.6, 0.6, 0.6);

        // --- CORREÇÃO DO BUG DE FADE & SOMBRAS ---
        mesh.traverse(c => { 
            if(c.isMesh) { 
                c.castShadow = true; 
                c.receiveShadow = true;
                
                // IMPORTANTE: Clonamos o material para que o FadeManager
                // afete apenas ESTE jogador, e não todos que usam o mesmo modelo.
                if (c.material) {
                    c.material = c.material.clone();
                    // Garante que comece opaco e com escrita no buffer de profundidade correta
                    c.material.transparent = false;
                    c.material.depthWrite = true;
                }
            } 
        });  
        // -----------------------------------------
        
        setupAnimations(mesh, gltf.animations);
        
        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.rotation.y = data.rotation;
        
        // Criação do Nome
        const sprite = createTextSprite(nameToShow, 'white');
        sprite.position.y = 3.0;
        mesh.add(sprite);
        
        scene.add(mesh);
        otherPlayers[data.id] = mesh;
        
        // Efeito visual de entrada suave
        FadeManager.fadeIn(mesh);
        
        playAnim(mesh, 'IDLE');
    });
}

function addMonster(data) {
    // Verifica se já existe
    if(monsters[data.id]) return;

    // 1. Pega a config centralizada (que veio do servidor no login)
    const typeConfig = globalMonsterTypes[data.type];
    
    // Se não tiver config para esse tipo, aborta
    if (!typeConfig) return;

    // 2. Define qual Modelo usar
    const modelName = typeConfig.model; 
    const tpl = monsterTemplates[modelName];

    // Se o modelo ainda não carregou, aborta
    if(!tpl) return; 

    // Clona a cena do modelo
    const mesh = tpl.scene.clone();
    
    // Configura dados internos
    mesh.userData.id = data.id; 
    mesh.userData.name = typeConfig.name;

    // Aplica o SCALE (Tamanho) definido no GameConfig
    const s = typeConfig.scale || 0.5; 
    mesh.scale.set(s, s, s);

    // --- CORREÇÃO DO FADE INDIVIDUAL ---
    mesh.traverse(c => { 
        if(c.isMesh) { 
            c.castShadow = true; 
            c.receiveShadow = true;
            
            // Clonamos o material para que o Fade afete SÓ este monstro
            if (c.material) {
                c.material = c.material.clone();
                c.material.transparent = false; 
                c.material.depthWrite = true;
            }
        } 
    });  
    // -----------------------------------
    
    // Configura animações
    setupAnimations(mesh, tpl.animations);
    
    // Posiciona
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.rotation.y = data.rotation;
    
    // Adiciona à cena e à lista lógica
    scene.add(mesh);
    monsters[data.id] = mesh;
    
    // Configura interpolação
    mesh.userData.targetPos = mesh.position.clone();
    mesh.userData.targetRot = data.rotation;

    // Efeito de entrada suave
    FadeManager.fadeIn(mesh);
}
// Referência ao container (cache para performance)
const damageContainer = document.getElementById('damage-container');

// --- COLISÃO & LOOP ---
function checkCollision(position, direction, distance) {
    if(!environmentLayer) return false;
    tempOrigin.copy(position).y += 0.5;
    raycaster.set(tempOrigin, direction);
    const intersects = raycaster.intersectObjects(environmentLayer.children, true);
    return (intersects.length > 0 && intersects[0].distance < distance);
}

function findBestTarget() {
    if (!myPlayer) return null;
    
    const RANGE_SQ = 4.0; // 2 metros ao quadrado
    let best = null;
    let minDistSq = Infinity;

    // OTIMIZAÇÃO: Loop 'for-in' evita criar Arrays novos a cada clique (Garbage Collection Friendly)
    
    // 1. Monstros
    for (const id in monsters) {
        const m = monsters[id];
        // Distância manual (mais rápido que Vector3.distanceTo)
        const dx = m.position.x - myPlayer.position.x;
        const dz = m.position.z - myPlayer.position.z;
        const distSq = (dx * dx) + (dz * dz);

        if (distSq <= RANGE_SQ && distSq < minDistSq) {
            best = m;
            minDistSq = distSq;
        }
    }

    // 2. Players (se não achou monstro)
    if (!best) {
        for (const id in otherPlayers) {
            const p = otherPlayers[id];
            const dx = p.position.x - myPlayer.position.x;
            const dz = p.position.z - myPlayer.position.z;
            const distSq = (dx * dx) + (dz * dz);

            if (distSq <= RANGE_SQ && distSq < minDistSq) {
                best = p;
                minDistSq = distSq;
            }
        }
    }
    
    return best;
}

function performAttack() {
    if(getIsChatActive() || isSitting || !myPlayer) return;
    
    // 1. Busca alvo (agora otimizada)
    const foundTargetMesh = findBestTarget();
    if (foundTargetMesh) currentTargetId = foundTargetMesh.userData.id;

    const targetObj = monsters[currentTargetId] || otherPlayers[currentTargetId];
    if (targetObj) {
        const dist = myPlayer.position.distanceTo(targetObj.position);
        if (dist <= 3.0) {
            const dx = targetObj.position.x - myPlayer.position.x;
            const dz = targetObj.position.z - myPlayer.position.z;
            myPlayer.rotation.y = Math.atan2(dx, dz);
        }
        if(targetRing) {
             targetRing.visible = true;
             targetRing.position.set(targetObj.position.x, 0.05, targetObj.position.z);
        }
    }

    // 2. Configura Estado
    isAttacking = true;
    attackTimer = ATTACK_COOLDOWN / 1000; // Converte ms para segundos (Ex: 0.8)
    
    playAnim(myPlayer, 'ATTACK');
    
    // 3. Rede (A lógica de envio contínuo ficará no animate agora)
    socket.emit('attack_request');
}

function animate() {
    requestAnimationFrame(animate);
    
    const now = Date.now(); 
    frameCount++;
    
    // OTIMIZAÇÃO DOM: Atualiza o contador de FPS apenas a cada 1 segundo (não a cada frame)
    // Isso libera a Thread principal para processar o jogo.
    if (now - lastFpsTime >= 1000) {
        if(UI.dbgFps) {
            UI.dbgFps.textContent = frameCount;
            const fps = parseInt(UI.dbgFps.textContent);
            UI.dbgFps.style.color = fps >= 50 ? '#00ff00' : (fps >= 30 ? '#ffff00' : '#ff0000');
        }
        frameCount = 0; lastFpsTime = now;
    }

    const delta = clock.getDelta();
    FadeManager.update(delta);

    // ==================================================================
    // 1. JOGADOR LOCAL
    // ==================================================================
    if(myPlayer && !isMapLoading) {
        if(myPlayer.userData.mixer) myPlayer.userData.mixer.update(delta);
        
        // OTIMIZAÇÃO DOM: Atualiza as coordenadas de debug apenas a cada 10 frames
        // Evita "Layout Thrashing" (o navegador recalculando estilo loucamente)
        if (frameCount % 10 === 0) {
            updateDebug(currentMapConfig ? currentMapConfig.id : '', myPlayer.position, Object.keys(otherPlayers).length + 1, totalOnline);
        }

        const isChatActive = getIsChatActive();

        // --- GERENCIAMENTO DE ESTADO (Ataque Contínuo Fluido) ---
        if (isAttacking) {
            attackTimer -= delta; 
            
            if (attackTimer <= 0) {
                isAttacking = false;

                // TRUQUE DE FLUIDEZ:
                // Se o tempo acabou mas a tecla F continua apertada, NÃO voltamos para IDLE.
                // Deixamos cair direto no bloco abaixo para reiniciar o ataque imediatamente.
                // Isso evita o custo de processamento de trocar Animação A -> B -> A em 1 frame.
                if ((!keys['f'] || isChatActive) && !isSitting) {
                    playAnim(myPlayer, 'IDLE');
                }
            }
        }

        // --- INPUT E RE-ATAQUE ---
        // Checa cooldown visual e input
        if (!isChatActive && keys['f'] && !isAttacking && (now - lastAttackTime > ATTACK_COOLDOWN)) {
            performAttack(); 
            lastAttackTime = now;
        }

        // --- MOVIMENTAÇÃO ---
        let isMoving = false;

        if(!isChatActive && !isSitting && !isAttacking) { 
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
                    
                    if (currentMapConfig) {
                        const halfMap = currentMapConfig.mapSize / 2;
                        const maxLimit = halfMap - CONFIG.mapPadding; 
                        const minLimit = -(halfMap - CONFIG.mapPadding) - 1.0; 

                        if (nextX > minLimit && nextX < maxLimit && nextZ > minLimit && nextZ < maxLimit) {
                            myPlayer.position.x = nextX;
                            myPlayer.position.z = nextZ;
                            isMoving = true;
                        }
                    }
                }

                // Rotação
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
        }
        
        // Câmera
        tempOrigin.copy(myPlayer.position).add(new THREE.Vector3(0, 6, 7)); 
        camera.position.lerp(tempOrigin, 0.1);
        camera.lookAt(myPlayer.position.x, myPlayer.position.y + 1, myPlayer.position.z);

        // --- REDE (Heartbeat) ---
        if(now - lastPacketTime > 50) {
            let animToSend = 'IDLE';
            if (isAttacking) animToSend = 'ATTACK';
            else if (isSitting) animToSend = 'SIT';
            else if (isMoving) animToSend = keys['shift'] ? 'RUN' : 'WALK';

            socket.emit('player_update', { 
                position: myPlayer.position, 
                rotation: myPlayer.rotation.y, 
                animation: animToSend 
            });
            lastPacketTime = now;
        }
    }

    // ==================================================================
    // 2. PLAYERS REMOTOS (Loop Otimizado)
    // ==================================================================
    const LERP_SPEED = 6.0;
    const ROT_SPEED = 10.0;

    // OTIMIZAÇÃO: Substituído Object.values().forEach por for-in
    // Evita criar array de objetos a cada frame (reduz pressão no Garbage Collector)
    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (!p.userData.targetPos) continue;

        const dist = p.position.distanceTo(p.userData.targetPos);
        if (dist > 0.05) {
            const lerpFactor = Math.min(delta * LERP_SPEED, 1.0);
            p.position.lerp(p.userData.targetPos, lerpFactor);
        }

        p.quaternion.slerp(p.userData.targetQuat, Math.min(delta * ROT_SPEED, 1.0));

        // Animação Remota
        const serverAnim = p.userData.serverAnimation;
        let finalAnim = 'IDLE';

        if (serverAnim === 'ATTACK' || serverAnim === 'SIT' || serverAnim === 'DEAD') {
            finalAnim = serverAnim;
        } else {
            if (dist > 0.1) finalAnim = (serverAnim === 'RUN') ? 'RUN' : 'WALK';
        }

        if (p.userData.currentAnimation !== finalAnim) {
            playAnim(p, finalAnim);
            p.userData.currentAnimation = finalAnim;
            if (finalAnim === 'ATTACK') p.userData.lastRemoteAttack = now;
        } else if (finalAnim === 'ATTACK') {
            const timeSinceLast = now - (p.userData.lastRemoteAttack || 0);
            if (timeSinceLast >= ATTACK_COOLDOWN) {
                playAnim(p, 'ATTACK'); 
                p.userData.lastRemoteAttack = now;
            }
        }

        if(p.userData.mixer) p.userData.mixer.update(delta);
    }

    // ==================================================================
    // 3. MONSTROS (Loop Otimizado)
    // ==================================================================
    // OTIMIZAÇÃO: for-in loop para evitar alocação de memória
    for (const id in monsters) {
        const m = monsters[id];

        if(m.userData.targetPos) {
            const dist = m.position.distanceTo(m.userData.targetPos);
            if(dist > 5.0) m.position.copy(m.userData.targetPos);
            else m.position.lerp(m.userData.targetPos, CONFIG.lerpFactorMonster);
        }
        
        if(m.userData.targetRot !== undefined) {
            let diff = m.userData.targetRot - m.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            m.rotation.y += diff * CONFIG.lerpFactorMonster;
        }

        if(m.userData.mixer) m.userData.mixer.update(delta);
    }

    // ==================================================================
    // 4. VISUAL FX
    // ==================================================================
    const activeTarget = monsters[currentTargetId] || otherPlayers[currentTargetId];
    if (targetRing) {
        if (activeTarget) {
            targetRing.visible = true;
            targetRing.position.lerp(activeTarget.position, 0.2);
            targetRing.position.y = 0.05;
        } else {
            targetRing.visible = false;
        }
    }

    renderer.render(scene, camera);
}