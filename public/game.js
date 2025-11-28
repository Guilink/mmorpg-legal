// public/game.js

import { CONFIG } from './js/Config.js';
import { 
    UI, toggleForms, showAuthError, showGameInterface, updateHUD, updateDebug, 
    addLogMessage, toggleChatFocus, toggleStatusWindow, setupStatusWindowData,
    refreshStatusWindow, changeAttr, getTempAttributes, updateLoadingBar,
    renderHotbar, getHotkeyItem, toggleInventory, toggleSkills, startCooldownUI 
} from './js/UIManager.js';
import { keys, setupInputs, getIsChatActive, setChatActive } from './js/InputManager.js';
import { 
    FadeManager, createChatBubble, showDamageNumber, createTargetIndicator, 
    createTextSprite, GroundItemManager, ParticleManager, ProjectileManager, AreaCursor
} from './js/VFX.js';

// --- INICIALIZAÇÃO DO SOCKET ---
const socket = io();

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, clock;
let environmentLayer; 
let myPlayer = null;
let myUsername = "";
let otherPlayers = {};
let monsters = {};
let monsterTemplates = {}; 
let globalMonsterTypes = {};
let targetRing = null; 
let currentTargetId = null; 
let frameCount = 0;
let lastFpsTime = 0;
let itemDB = {};
let lastPickupTime = 0;
let myInventory = []; 
let myEquipment = {}; // Armazena o equipamento atual para sabermos a arma
let lastRenderedTargetId = null;
let pendingSkill = null; 
let localCooldowns = {}; // Armazena quando o cooldown de cada skill VAI ACABAR (Timestamp)
let castingTimer = null; // Armazena o timer do client para cancelar se andar

// No UIManager ou referenciando direto
const castBarContainer = document.getElementById('cast-bar-container');
const castFill = document.getElementById('cast-fill');
const castName = document.getElementById('cast-name');
let castTween = null; // Para animar a barra via JS se precisar, ou usar CSS transition

const pendingLoads = new Set();
const tempVector = new THREE.Vector3();
const tempOrigin = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = 0.3;

let isMapLoading = false;
let isPlayerLoading = false;
let isAttacking = false; 
let attackTimer = 0; 
let isSitting = false;   
let lastAttackTime = 0;
const ATTACK_COOLDOWN = 800; 
let currentMapConfig = null;
let lastPacketTime = 0;
let totalOnline = 1;
const myMsgHistory = [];
const MAX_HISTORY = 10; 
let historyIndex = -1;
let lastSitTime = 0;

let myStats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };
let myLevel = 1, myXp = 0, myNextXp = 100, myPoints = 0;
let myAttributes = { str: 5, agi: 5, int: 5, vit: 5 };

let skillDB = {};

// --- JANELAS UI ---
window.toggleForms = toggleForms;
window.toggleStatusWindow = () => {
    setupStatusWindowData(myAttributes, myPoints, myStats); 
    toggleStatusWindow();
};
window.changeAttr = changeAttr; 

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
    const newAttrs = getTempAttributes(); 
    socket.emit('distribute_points', newAttrs);
    toggleStatusWindow(); 
};

window.toggleSkills = toggleSkills; // Permite que o botão HTML onclick="toggleSkills()" funcione

window.toggleInventory = () => {
    const el = document.getElementById('inventory-window');
    const tooltip = document.getElementById('item-tooltip'); 
    if (el.style.display === 'none') {
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
    }
};

window.useItem = (index) => socket.emit('use_item', index);
window.unequipItem = (slot) => socket.emit('unequip_item', slot);

window.addEventListener('mousedown', (e) => {
    if (getIsChatActive()) return;

    // --- MODO DE MIRA (SKILL DE ÁREA) ---
    if (pendingSkill) {
        // Botão Direito: Cancela
        if (e.button === 2) {
            pendingSkill = null;
            AreaCursor.setVisible(false);
            addLogMessage('SISTEMA', 'Cancelado.', 'system');
            return;
        }

 // Botão Esquerdo: Dispara Skill de Área
        if (e.button === 0) {
            // ... (Lógica de raycast/shift igual) ...
            // Copie a lógica de definir targetPoint que já estava lá
            let targetPoint = null;
            if (keys['shift']) { targetPoint = cursorWorldPos.clone(); } 
            else { 
                mouse.x = (e.clientX / window.innerWidth) * 2 - 1; 
                mouse.y = -(e.clientY / window.innerHeight) * 2 + 1; 
                raycaster.setFromCamera(mouse, camera); 
                const intersects = raycaster.intersectObjects(environmentLayer.children, true); 
                if (intersects.length > 0) targetPoint = intersects[0].point; 
            }
            
            if (targetPoint) {
                // 1. Verifica Cooldown Local
                const now = Date.now();
                if (localCooldowns[pendingSkill.id] && now < localCooldowns[pendingSkill.id]) {
                    addLogMessage('SISTEMA', 'Habilidade em recarga.', 'system');
                    return; 
                }

                // 2. Verifica Mana Local (NOVO!)
                if (myStats.mp < pendingSkill.manaCost) {
                    addLogMessage('SISTEMA', 'Mana insuficiente.', 'system');
                    // Opcional: Cancelar a mira ou deixar tentar de novo?
                    // Vamos manter a mira ativa para ele tentar quando recuperar mana, ou cancela com direito.
                    return; 
                }

                const dx = targetPoint.x - myPlayer.position.x;
                const dz = targetPoint.z - myPlayer.position.z;
                myPlayer.rotation.y = Math.atan2(dx, dz);
                socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: 'IDLE' });

                socket.emit('use_skill', { 
                    skillId: pendingSkill.id, targetId: null, x: targetPoint.x, z: targetPoint.z 
                });

                if (pendingSkill.castTime > 0) {
                    if (castingTimer) clearTimeout(castingTimer);
                    castingTimer = setTimeout(() => {
                        startCooldownUI(pendingSkill.id, pendingSkill.cooldown);
                        localCooldowns[pendingSkill.id] = Date.now() + pendingSkill.cooldown;
                        castingTimer = null;
                    }, pendingSkill.castTime);
                } else {
                    startCooldownUI(pendingSkill.id, pendingSkill.cooldown);
                    localCooldowns[pendingSkill.id] = Date.now() + pendingSkill.cooldown;
                }

                pendingSkill = null;
                AreaCursor.setVisible(false);
            }
        }
        return; // Impede clicar em monstros/andar enquanto mira
    }
    // -------------------------------------

    // Só botão esquerdo daqui pra baixo (Seleção normal)
    if (e.button !== 0) return;

    // ... (Resto do código original de selecionar item/monstro) ...
    // Copie a lógica que já fizemos antes para selecionar Itens e Monstros/Players aqui
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const groundSprites = Object.values(GroundItemManager.items);
    const intersectItems = raycaster.intersectObjects(groundSprites);

    if (intersectItems.length > 0) {
        const target = intersectItems[0].object;
        if (target.userData.isGroundItem) {
            socket.emit('pickup_request', target.userData.uniqueId);
            return; 
        }
    }

    const clickables = [];
    Object.values(monsters).forEach(m => clickables.push(m));
    Object.values(otherPlayers).forEach(p => clickables.push(p));
    
    const intersectEntities = raycaster.intersectObjects(clickables, true);

    if (intersectEntities.length > 0) {
        let hit = intersectEntities[0].object;
        while(hit.parent && !hit.userData.id) { hit = hit.parent; }

        if (hit.userData.id) {
            currentTargetId = hit.userData.id;
            if(targetRing) {
                targetRing.visible = true;
                targetRing.position.set(hit.position.x, 0.05, hit.position.z);
            }
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (!pendingSkill) return; // Só calcula se estiver mirando

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Intersecta com o ambiente (chão)
    const intersects = raycaster.intersectObjects(environmentLayer.children, true);
    
    if (intersects.length > 0) {
        AreaCursor.updatePosition(intersects[0].point);
    }
});

function playBGM(file) {
    if (bgmAudio.src.includes(file)) return; 
    bgmAudio.src = file;
    bgmAudio.play().catch(e => console.log("Audio: Clique necessário"));
}
window.addEventListener('click', () => {
    if(UI.loginScreen.style.display !== 'none') playBGM('assets/bgm1.webm');
}, { once: true });

// --- SOCKET EVENTS ---
socket.on('register_success', (msg) => { alert(msg); toggleForms(); });
socket.on('login_error', (msg) => showAuthError(msg, 'login'));

socket.on('login_success', (data) => {
    playBGM('assets/bgm2.webm');
    showGameInterface(); 
    
    myUsername = data.playerData.username; 
    if(data.playerData.stats) myStats = data.playerData.stats;
    myLevel = data.playerData.level || 1;
    myXp = data.playerData.xp || 0;
    myNextXp = data.playerData.nextLevelXp || 100;
    myAttributes = data.playerData.attributes || { str:5, agi:5, int:5, vit:5 };
    myPoints = data.playerData.points || 0;
    globalMonsterTypes = data.monsterTypes || {};

    myInventory = data.inventory;
    myEquipment = data.equipment || {}; // Salva equipamento
    itemDB = data.itemDB;
    skillDB = data.skillDB;

    initEngine(); 
    updateHUD(myStats, myLevel, myXp, myNextXp); 
    UI.updateInventory(data.inventory, data.equipment, itemDB, skillDB);
    renderHotbar(myInventory, itemDB, skillDB); 

    loadMap(data.mapConfig, data.playerData, data.mapPlayers, data.mapMonsters);
    
    if (data.mapGroundItems) {
        Object.values(data.mapGroundItems).forEach(item => {
            GroundItemManager.spawn(item, scene, itemDB);
        });
    }
});

socket.on('ground_item_spawn', (item) => GroundItemManager.spawn(item, scene, itemDB));
socket.on('ground_item_remove', (id) => GroundItemManager.remove(id, scene));
socket.on('ground_item_expire', (id) => GroundItemManager.expire(id, scene));

socket.on('inventory_update', (data) => {
    myInventory = data.inventory; 
    myEquipment = data.equipment; // Atualiza equipamento
    UI.updateInventory(data.inventory, data.equipment, itemDB);
    renderHotbar(myInventory, itemDB, skillDB);
});

socket.on('map_changed', (data) => { 
    currentTargetId = null; 
    if(targetRing) targetRing.visible = false;
    loadMap(data.mapConfig, data.playerData, data.mapPlayers, data.mapMonsters); 
    if (data.mapGroundItems) {
        Object.values(data.mapGroundItems).forEach(item => GroundItemManager.spawn(item, scene, itemDB));
    }
});

socket.on('update_stats', (data) => {
    myStats = data.stats; 
    myLevel = data.level;
    myXp = data.xp;
    myNextXp = data.nextLevelXp;
    myAttributes = data.attributes;
    myPoints = data.points;
    updateHUD(myStats, myLevel, myXp, myNextXp);
    if(document.getElementById('st-points')) document.getElementById('st-points').textContent = myPoints;
    if (UI.statusWindow.style.display !== 'none') {
        setupStatusWindowData(myAttributes, myPoints, myStats);
        refreshStatusWindow();
    }
});

socket.on('player_joined', (data) => { if(data.id !== socket.id) addOtherPlayer(data); });
socket.on('player_left', (id) => { 
    if (pendingLoads.has(id)) pendingLoads.delete(id);
    if(otherPlayers[id]) { 
        FadeManager.fadeOutAndRemove(otherPlayers[id], scene); 
        delete otherPlayers[id]; 
    } 
});

socket.on('player_moved', d => {
    if(d.id === socket.id) return;
    if(!otherPlayers[d.id]) { addOtherPlayer(d); return; }
    const p = otherPlayers[d.id];
    p.userData.targetPos.set(d.position.x, d.position.y, d.position.z);
    const targetEuler = new THREE.Euler(0, d.rotation, 0, 'XYZ');
    p.userData.targetQuat.setFromEuler(targetEuler);
    p.userData.serverAnimation = d.animation; 
    if (p.position.distanceTo(p.userData.targetPos) > 5.0) {
        p.position.copy(p.userData.targetPos);
        p.quaternion.copy(p.userData.targetQuat);
    }
});

socket.on('monsters_update', (pack) => {
    if(isMapLoading) return;
    const now = Date.now();
    const serverIds = new Set();
    pack.forEach(d => {
        serverIds.add(d.id);
        if (d.hp <= 0 && monsters[d.id]) {
            FadeManager.fadeOutAndRemove(monsters[d.id], scene);
            delete monsters[d.id];
            if(currentTargetId === d.id) { currentTargetId = null; if(targetRing) targetRing.visible = false; }
            return; 
        }        
        if(monsters[d.id]) {
            const mob = monsters[d.id];
            if(mob.userData.targetPos) mob.userData.targetPos.set(d.position.x, d.position.y, d.position.z);
            mob.userData.targetRot = d.rotation;
            if(mob.userData.current !== d.animation) playAnim(mob, d.animation);
            mob.userData.hp = d.hp;
            mob.userData.lastSeen = now;
        } else { 
            addMonster(d);
            if(monsters[d.id]) monsters[d.id].userData.lastSeen = now;
        }
    });

    const TOLERANCE = 2000; 
    Object.keys(monsters).forEach(localId => {
        const m = monsters[localId];
        if(!serverIds.has(localId)) {
            if (m.userData.lastSeen && (now - m.userData.lastSeen > TOLERANCE)) {
                scene.remove(m); 
                delete monsters[localId];
                if(currentTargetId === localId) {
                    currentTargetId = null;
                    if(targetRing) targetRing.visible = false;
                }
            }
        }
    });
});

socket.on('monster_dead', (id) => { 
    if(currentTargetId === id) {
        currentTargetId = null; 
        if(targetRing) targetRing.visible = false;
    }
    if(monsters[id]) { 
        FadeManager.fadeOutAndRemove(monsters[id], scene); 
        delete monsters[id]; 
    } 
});

socket.on('projectile_fired', (data) => {
    // 1. Acha quem atirou
    let shooter = null;
    if (data.shooterId === socket.id) shooter = myPlayer;
    else if (otherPlayers[data.shooterId]) shooter = otherPlayers[data.shooterId];
    else if (monsters[data.shooterId]) shooter = monsters[data.shooterId];

    // 2. Acha quem é o alvo
    let target = null;
    if (data.targetId === socket.id) target = myPlayer;
    else if (otherPlayers[data.targetId]) target = otherPlayers[data.targetId];
    else if (monsters[data.targetId]) target = monsters[data.targetId];

    // 3. Cria a flecha
    if (shooter && target) {
        // Passe data.type aqui
        ProjectileManager.spawn(scene, shooter, target, data.type); 
    }
});

socket.on('cast_start', (data) => {
    // Se SOU EU castando, mostra a barra
    if (data.id === socket.id) {
        castBarContainer.style.display = 'block';
        castName.textContent = data.skillName;
        castFill.style.width = '0%';
        castFill.style.transition = 'none'; // Reseta
        
        // Força reflow
        void castFill.offsetWidth; 

        castFill.style.transition = `width ${data.time}ms linear`;
        castFill.style.width = '100%';
        
        // Esconde depois que acabar
        setTimeout(() => {
            castBarContainer.style.display = 'none';
        }, data.time);
    }
    
    // Opcional: Mostrar uma animação/efeito em cima do personagem de quem está castando (mesmo se for outro player)
});

socket.on('cast_interrupted', (id) => {
    if (id === socket.id) {
        castBarContainer.style.display = 'none';
        castFill.style.width = '0%';
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

    // Tenta achar o alvo vivo primeiro
    if (d.targetId === socket.id) {
        if (myPlayer) pos = myPlayer.position.clone();
    } else if (monsters[d.targetId]) {
        pos = monsters[d.targetId].position.clone();
    } else if (otherPlayers[d.targetId]) {
        pos = otherPlayers[d.targetId].position.clone();
    } 
    // FALLBACK: Se não achou (porque morreu e foi deletado), usa a coordenada do pacote
    else if (d.x !== undefined && d.z !== undefined) {
        pos = new THREE.Vector3(d.x, 0, d.z);
    }

     if (pos) {
        showDamageNumber(d.damage, pos, color, camera); 
    }
});

socket.on('play_vfx', (data) => {
    let pos = null;

    // Se veio coordenadas, usa elas
    if (data.x !== undefined && data.z !== undefined) {
        pos = new THREE.Vector3(data.x, 0, data.z);
    } 
    // Se veio ID, busca o objeto
    else {
        let targetObj = null;
        if (data.targetId === socket.id) targetObj = myPlayer;
        else if (otherPlayers[data.targetId]) targetObj = otherPlayers[data.targetId];
        else if (monsters[data.targetId]) targetObj = monsters[data.targetId];
        if (targetObj) pos = targetObj.position;
    }

    if (pos) {
        if (data.type === 'METEOR_EXPLOSION') {
            // Efeito maior e vermelho/laranja
            ParticleManager.spawnBurst(scene, pos, 0xff4400, 30); 
        } else {
            let color = 0xffffff; 
            if (data.type === 'POTION_HP') color = 0xff0000; 
            if (data.type === 'POTION_MP') color = 0x0000ff; 
            ParticleManager.spawnBurst(scene, pos, color, 10);
        }
    }
});

socket.on('server_stats', (data) => { totalOnline = data.total; });

// --- ENGINE & INITIALIZATION ---
function initEngine() {
    if (renderer) return;

    clock = new THREE.Clock();
    
    scene = new THREE.Scene(); 
    const skyColor = 0x87CEEB; 
    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(skyColor, 5, 35);

    environmentLayer = new THREE.Group();
    scene.add(environmentLayer);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap; 

    UI.canvasContainer.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(20, 50, 20);
    dir.castShadow = false;
    scene.add(dir);

    targetRing = createTargetIndicator(scene); 
    AreaCursor.create(scene);

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
            e.preventDefault(); UI.chatInput.blur(); return;
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
            } else if (isDown) {
                if (historyIndex === -1) return; 
                historyIndex++; 
                if (historyIndex >= myMsgHistory.length) { historyIndex = -1; UI.chatInput.value = ""; } 
                else { UI.chatInput.value = myMsgHistory[historyIndex]; }
            }
        }
    });

window.triggerHotkey = (slotIndex) => {
        const slotData = getHotkeyItem(slotIndex);
        if (!slotData) return; 

        if (slotData.type === 'ITEM') {
            const inventoryIndex = myInventory.findIndex(slot => slot.id === slotData.id);
            if (inventoryIndex !== -1) socket.emit('use_item', inventoryIndex);
        } 
        else if (slotData.type === 'SKILL') {
            const skill = skillDB[slotData.id];
            if (!skill) return;

            // 1. VERIFICA COOLDOWN LOCAL
            const now = Date.now();
            if (localCooldowns[skill.id] && now < localCooldowns[skill.id]) {
                addLogMessage('SISTEMA', 'Habilidade em recarga.', 'system');
                return; 
            }

            // 2. VERIFICA MANA LOCAL
            if (myStats.mp < skill.manaCost) {
                addLogMessage('SISTEMA', 'Mana insuficiente.', 'system');
                return;
            }

            // Lógica de Auto-Target (Mantida igual)
            const GLOBAL_CHASE_LIMIT = 15.0;
            if (skill.type === 'MELEE') {
                checkAndSwapMeleeTarget();
            } else if ((skill.type === 'CASTING' || skill.type === 'INSTANT') && !currentTargetId) {
                let needNewTarget = !currentTargetId;
                if (currentTargetId) {
                    const t = monsters[currentTargetId] || otherPlayers[currentTargetId];
                    if (t) {
                        const dist = myPlayer.position.distanceTo(t.position);
                        const giveUpDistance = Math.max(GLOBAL_CHASE_LIMIT, skill.range + 1.0);
                        if (dist > giveUpDistance) { currentTargetId = null; needNewTarget = true; }
                    } else { needNewTarget = true; }
                }
                if (needNewTarget) {
                    const foundId = findBestAutoTarget(skill.range);
                    if (foundId) {
                        currentTargetId = foundId;
                        const newT = monsters[foundId] || otherPlayers[foundId];
                        if (targetRing && newT) {
                            targetRing.visible = true; targetRing.position.copy(newT.position); lastRenderedTargetId = foundId;
                        }
                    }
                }
            }

            // Lógica de Área (Meteoro)
            if (skill.type === 'AREA') {
                pendingSkill = skill;
                AreaCursor.setVisible(true, skill.radius);
                addLogMessage('SISTEMA', 'Selecione a área.', 'system');
                return; 
            }

            // --- EXECUÇÃO DO COMANDO ---
            if (currentTargetId || skill.type === 'SUPPORT' || skill.type === 'MELEE') {
                
                if (currentTargetId) {
                    const targetObj = monsters[currentTargetId] || otherPlayers[currentTargetId];
                    if (targetObj) {
                        const dist = myPlayer.position.distanceTo(targetObj.position);
                        
                        // --- CORREÇÃO: VALIDAÇÃO DE ALCANCE UNIVERSAL ---
                        // Se não for Support (que pode ser self-cast) e não for Area (já tratado acima)
                        if (skill.type !== 'SUPPORT') {
                            // Adicionamos uma pequena margem de 0.5m para compensar lag visual
                            // Se a distância for maior que o range da skill, BLOQUEIA.
                            if (dist > skill.range + 0.5) {
                                addLogMessage('SISTEMA', 'Alvo fora de alcance!', 'system');
                                return; // <--- O PULO DO GATO: Cancela envio e cooldown
                            }
                        }
                        // ------------------------------------------------

                        // Vira o char
                        const dx = targetObj.position.x - myPlayer.position.x;
                        const dz = targetObj.position.z - myPlayer.position.z;
                        myPlayer.rotation.y = Math.atan2(dx, dz);
                        socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: 'IDLE' });
                    }
                }
                
                if (skill.type === 'MELEE') playAnim(myPlayer, 'ATTACK');

                // Envia para o servidor
                socket.emit('use_skill', { skillId: slotData.id, targetId: currentTargetId });

                // Inicia Cooldown Visual
                if (skill.castTime > 0) {
                    if (castingTimer) clearTimeout(castingTimer);
                    castingTimer = setTimeout(() => {
                        if (skill.cooldown > 0) {
                            startCooldownUI(skill.id, skill.cooldown);
                            localCooldowns[skill.id] = Date.now() + skill.cooldown;
                        }
                        castingTimer = null;
                    }, skill.castTime);
                } else {
                    if (skill.cooldown > 0) {
                        startCooldownUI(skill.id, skill.cooldown);
                        localCooldowns[skill.id] = Date.now() + skill.cooldown;
                    }
                }
            
            } else {
                addLogMessage('SISTEMA', 'Selecione um alvo (TAB) para esta skill.', 'system');
            }
        }
    };

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
                } else { UI.chatInput.blur(); }
            } else { UI.chatInput.focus(); }
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
        },
        () => { 
            // ATAQUE (F)
            const now = Date.now();
            if (!getIsChatActive() && !isAttacking && (now - lastAttackTime > ATTACK_COOLDOWN)) {
                performAttack(); 
                lastAttackTime = now;
            }
        },
        () => window.toggleStatusWindow(), 
        () => window.toggleInventory(),             
        () => { // PEGAR ITEM (Q)
                if(!myPlayer) return;
                const now = Date.now();
                if (now - lastPickupTime < 1000) return; 
                lastPickupTime = now;
                let closestId = null; let minDist = 1.5; 
                Object.values(GroundItemManager.items).forEach(sprite => {
                    if (sprite.userData.state === 'PICKUP') return;
                    const dist = myPlayer.position.distanceTo(sprite.position);
                    if (dist < minDist) { minDist = dist; closestId = sprite.userData.uniqueId; }
                });
                if (closestId) socket.emit('pickup_request', closestId);
        },
        (keyNumber) => window.triggerHotkey(keyNumber - 1),
        () => selectNextTarget(),
        () => window.toggleSkills() // Tecla S
    );        

    window.addEventListener('resize', () => { 
        if(!camera || !renderer) return;
        camera.aspect = window.innerWidth/window.innerHeight; 
        camera.updateProjectionMatrix(); 
        renderer.setSize(window.innerWidth, window.innerHeight); 
    });

    animate();
}

// --- NOVA FUNÇÃO DE AUTO-AIM (Busca alvo apenas no raio especificado) ---
function findBestAutoTarget(maxRange) {
    if (!myPlayer) return null;

    let bestId = null;
    let bestDist = maxRange; // Começa com o limite máximo permitido

    // 1. Procura em Monstros
    for (const id in monsters) {
        const m = monsters[id];
        if (m.userData.hp <= 0) continue;
        
        const dist = myPlayer.position.distanceTo(m.position);
        if (dist <= bestDist) { // Só pega se estiver DENTRO do raio
            bestDist = dist;
            bestId = id;
        }
    }

    // 2. Procura em Players (se PVP for true)
    if (currentMapConfig && currentMapConfig.pvp) {
        for (const id in otherPlayers) {
            const p = otherPlayers[id];
            const dist = myPlayer.position.distanceTo(p.position);
            if (dist <= bestDist) {
                bestDist = dist;
                bestId = id;
            }
        }
    }

    return bestId;
}

// --- FUNÇÃO DE TROCA INTELIGENTE (MELEE) ---
function checkAndSwapMeleeTarget() {
    // 1. Verifica a distância do alvo ATUAL (se tiver)
    let currentDist = Infinity;
    if (currentTargetId) {
        const t = monsters[currentTargetId] || otherPlayers[currentTargetId];
        if (t) {
            currentDist = myPlayer.position.distanceTo(t.position);
        } else {
            // Se o ID existe mas o objeto não (bug/desync), reseta
            currentTargetId = null;
        }
    }

    // 2. Se o alvo atual estiver longe (> 2.5m) OU se não tiver alvo...
    if (currentDist > 2.5 || !currentTargetId) { // distacia do alvo atual
        // ...Tenta achar alguém NOVO bem perto
        const newId = findBestAutoTarget(2.0); // distancia para detectar alguém
        
        // 3. Se achou alguém perto, TROCA O ALVO
        if (newId) {
            currentTargetId = newId;
            
            // Atualiza o anel visual imediatamente
            const newTarget = monsters[newId] || otherPlayers[newId];
            if (targetRing && newTarget) {
                targetRing.visible = true;
                targetRing.position.set(newTarget.position.x, 0.05, newTarget.position.z);
            }
        }
    }
}

// --- SISTEMA DE TARGETING (TAB) ---
function selectNextTarget() {
    if (!myPlayer) return;

    const MAX_TAB_DISTANCE = 20.0; 
    const MAX_CANDIDATES = 5;      

    let candidates = [];
    
    // 1. Monstros
    for (const id in monsters) {
        const m = monsters[id];
        if (m.userData.hp <= 0) continue;
        const dist = myPlayer.position.distanceTo(m.position);
        if (dist <= MAX_TAB_DISTANCE) candidates.push({ id: id, dist: dist, obj: m });
    }

    // 2. Players (SEMPRE permite selecionar, para poder curar)
    // A validação se pode ATACAR é feita no servidor ou na hora de apertar F
    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        const dist = myPlayer.position.distanceTo(p.position);
        if (dist <= MAX_TAB_DISTANCE) candidates.push({ id: id, dist: dist, obj: p });
    }

    if (candidates.length === 0) {
        currentTargetId = null;
        if(targetRing) targetRing.visible = false;
        return;
    }

    candidates.sort((a, b) => a.dist - b.dist);
    candidates = candidates.slice(0, MAX_CANDIDATES);

    let nextIndex = 0;
    if (currentTargetId) {
        const currentIndex = candidates.findIndex(c => c.id === currentTargetId);
        if (currentIndex !== -1) {
            nextIndex = (currentIndex + 1) % candidates.length;
        }
    }

    const best = candidates[nextIndex];
    currentTargetId = best.id;
    
    if(targetRing) {
        targetRing.visible = true;
        targetRing.position.set(best.obj.position.x, 0.05, best.obj.position.z);
    }
}

// --- VERIFICAR ÂNGULO (Matemática Vetorial) ---
function isTargetInFront(targetObj) {
    if (!myPlayer || !targetObj) return false;

    // 1. Vetor Direção do Jogador (Onde ele está olhando)
    const playerDir = new THREE.Vector3();
    myPlayer.getWorldDirection(playerDir);

    // 2. Vetor Distância até o Alvo (Normalizado)
    const targetDir = new THREE.Vector3()
        .subVectors(targetObj.position, myPlayer.position)
        .normalize();

    // 3. Produto Escalar (Dot Product)
    // Se for 1, está exatamente na frente. 
    // Se for 0, está 90 graus (do lado).
    // Se for -1, está nas costas.
    // Queremos algo como > 0.2 (aprox 160 graus de cone)
    const dot = playerDir.dot(targetDir);

    return dot > 0.2; 
}

function performAttack() {
    if(getIsChatActive() || isSitting || !myPlayer) return;

    let weaponId = myEquipment.weapon;
    let weaponConfig = weaponId ? itemDB[weaponId] : null;
    let isRanged = weaponConfig && weaponConfig.weaponType === 'ranged';
    let range = isRanged ? (weaponConfig.range || 10) : 2.5;

    // --- NOVA LÓGICA DE PERSEGUIÇÃO ---
    // Limite Global: Até 15m o jogo segura o alvo para você perseguir.
    // Se a arma tiver alcance MAIOR que 15m, o limite será o alcance da arma.
    const GLOBAL_CHASE_LIMIT = 15.0; 
    
    // 1. MELEE (Mantém a lógica de troca rápida para fluidez no soco)
    if (!isRanged) {
        checkAndSwapMeleeTarget();
    } 
    // 2. RANGED (Lógica Inteligente)
    else {
        let needNewTarget = !currentTargetId;

        if (currentTargetId) {
            const t = monsters[currentTargetId] || otherPlayers[currentTargetId];
            if (t) {
                const dist = myPlayer.position.distanceTo(t.position);
                
                // CALCULA O LIMITE DE DESISTÊNCIA
                // É o maior valor entre: "15m" OU "Range da Arma + 1m"
                const giveUpDistance = Math.max(GLOBAL_CHASE_LIMIT, range + 1.0);

                // Só descarta se superou esse limite inteligente
                if (dist > giveUpDistance) {
                    currentTargetId = null; 
                    needNewTarget = true;   
                }
            } else {
                needNewTarget = true;
            }
        }

        // Se precisou trocar, busca novo alvo DENTRO DO ALCANCE DA ARMA
        // (A busca sempre prioriza quem você pode acertar AGORA)
        if (needNewTarget) {
            const foundId = findBestAutoTarget(range);
            if (foundId) {
                currentTargetId = foundId;
                const newT = monsters[foundId] || otherPlayers[foundId];
                if (targetRing && newT) {
                    targetRing.visible = true;
                    // Usa copy para pular sem lerp
                    targetRing.position.copy(newT.position);
                    lastRenderedTargetId = foundId;
                }
            }
        }
    }
    
    // 3. Execução
    const targetObj = monsters[currentTargetId] || otherPlayers[currentTargetId];
    
    if (targetObj) {
        const dist = myPlayer.position.distanceTo(targetObj.position);
        
        if (isRanged) {
            // Se está travado no alvo, mas fora do alcance de ataque
            if (dist > range) {
                addLogMessage('SISTEMA', 'Alvo fora de alcance! Aproxime-se.', 'system');
                return; 
            }

            if (!isTargetInFront(targetObj)) {
                addLogMessage('SISTEMA', 'Precisa estar de frente para o alvo!', 'system');
                return;
            }
            const dx = targetObj.position.x - myPlayer.position.x;
            const dz = targetObj.position.z - myPlayer.position.z;
            myPlayer.rotation.y = Math.atan2(dx, dz);
        } 
        else {
            if (dist <= 3.5) {
                const dx = targetObj.position.x - myPlayer.position.x;
                const dz = targetObj.position.z - myPlayer.position.z;
                myPlayer.rotation.y = Math.atan2(dx, dz);
            }
        }

        if(targetRing) {
             targetRing.visible = true;
             if(currentTargetId !== lastRenderedTargetId) {
                 targetRing.position.copy(targetObj.position);
                 lastRenderedTargetId = currentTargetId;
             } else {
                 targetRing.position.lerp(targetObj.position, 0.2);
             }
             targetRing.position.y = 0.05;
        }
    } else {
        if (isRanged) return; 
    }

    isAttacking = true;
    attackTimer = ATTACK_COOLDOWN / 1000; 
    playAnim(myPlayer, 'ATTACK');
    socket.emit('attack_request', currentTargetId);
}

function loadMap(mapConfig, myData, players, mobs) {
    isMapLoading = true;
    currentMapConfig = mapConfig; 
    UI.loadingScreen.style.display = 'flex';
    UI.mapName.textContent = mapConfig.id.toUpperCase();
    updateLoadingBar(0); 
    environmentLayer.clear(); 
    Object.keys(otherPlayers).forEach(id => { scene.remove(otherPlayers[id]); delete otherPlayers[id]; });
    otherPlayers = {}; 
    Object.keys(monsters).forEach(id => { scene.remove(monsters[id]); delete monsters[id]; });
    monsters = {}; 
    GroundItemManager.clearAll(scene);    
    ParticleManager.clearAll(scene);
    const loader = new THREE.GLTFLoader();
    ProjectileManager.loadAsset(loader);
    let toLoad = 1; 
    if(!myPlayer && !isPlayerLoading) { toLoad++; isPlayerLoading = true; }

    const uniqueModels = new Set();
    Object.values(globalMonsterTypes).forEach(conf => { if(conf.model) uniqueModels.add(conf.model); });
    uniqueModels.forEach(modelName => {
        if(!monsterTemplates[modelName]) {
            toLoad++; 
            loader.load(`assets/${modelName}.glb`, g => { monsterTemplates[modelName] = g; checkDone(); }, undefined, () => checkDone());
        }
    });

    loader.load(
        'assets/' + mapConfig.asset, 
        (gltf) => {
            const model = gltf.scene;
            model.traverse(c => { 
                if(c.isMesh) { 
                    c.receiveShadow = true; c.castShadow = true;   
                    if(c.material) { c.material.transparent = false; c.material.alphaTest = 0.5; c.material.depthWrite = true; c.material.side = THREE.DoubleSide; c.material.dithering = false; }
                } 
            });
            const off = mapConfig.offset || { x: 0, y: 0, z: 0 };
            model.position.set(off.x, off.y, off.z);
            environmentLayer.add(model); 
            updateLoadingBar(100);
            checkDone();
        },
        (xhr) => { if (xhr.lengthComputable) updateLoadingBar((xhr.loaded / xhr.total) * 100); },
        (error) => { console.error('Erro map:', error); UI.mapName.textContent = "ERRO"; }
    );

    if(!myPlayer && isPlayerLoading) {
        loader.load('assets/heroi1.glb', gltf => {
            const mesh = gltf.scene;
            mesh.userData.id = socket.id; 
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
        if(toLoad <= 0) { isPlayerLoading = false; finalizeMapLoad(myData, players, mobs); }
    }
}

function finalizeMapLoad(myData, players, mobs) {
    if(myPlayer) {
        myPlayer.position.set(myData.position.x, myData.position.y, myData.position.z);
        isSitting = false; isAttacking = false;
        playAnim(myPlayer, 'IDLE');
    }
    if(currentMapConfig.portals) {
        currentMapConfig.portals.forEach(p => { ParticleManager.createPortal(scene, p.x, p.z); });
    }
    Object.values(players).forEach(p => { if(p.id !== socket.id) addOtherPlayer(p); });
    Object.values(mobs).forEach(m => addMonster(m));
    isMapLoading = false;
    setTimeout(() => UI.loadingScreen.style.display = 'none', 500);
}

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
    if (otherPlayers[data.id] || pendingLoads.has(data.id)) return;
    pendingLoads.add(data.id);
    if(data.id === socket.id) { pendingLoads.delete(data.id); return; }
    const nameToShow = data.username || "Desconhecido";
    const loader = new THREE.GLTFLoader();
    loader.load('assets/heroi1.glb', gltf => {
        if(!pendingLoads.has(data.id)) return; 
        if(otherPlayers[data.id]) scene.remove(otherPlayers[data.id]);
        const mesh = gltf.scene;
        mesh.userData.id = data.id; 
        mesh.userData.targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        mesh.userData.targetQuat = new THREE.Quaternion();
        mesh.userData.targetQuat.setFromEuler(new THREE.Euler(0, data.rotation, 0));
        mesh.userData.serverAnimation = data.animation || 'IDLE';
        mesh.userData.currentAnimation = '';
        mesh.scale.set(0.6, 0.6, 0.6);
        mesh.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true; if (c.material) { c.material = c.material.clone(); c.material.transparent = false; c.material.depthWrite = true; } } });  
        setupAnimations(mesh, gltf.animations);
        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.rotation.y = data.rotation;
        const sprite = createTextSprite(nameToShow, 'white');
        sprite.position.y = 3.0;
        mesh.add(sprite);
        scene.add(mesh);
        otherPlayers[data.id] = mesh;
        FadeManager.fadeIn(mesh);
        playAnim(mesh, 'IDLE');
        pendingLoads.delete(data.id);
    }, undefined, (e) => { console.error("Erro player:", e); pendingLoads.delete(data.id); });
}

function addMonster(data) {
    if(monsters[data.id]) return;
    const typeConfig = globalMonsterTypes[data.type];
    if (!typeConfig) return;
    const modelName = typeConfig.model; 
    const tpl = monsterTemplates[modelName];
    if(!tpl) return; 
    const mesh = tpl.scene.clone();
    mesh.userData.id = data.id; 
    mesh.userData.name = typeConfig.name;
    const s = typeConfig.scale || 0.5; 
    mesh.scale.set(s, s, s);
    mesh.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true; if (c.material) { c.material = c.material.clone(); c.material.transparent = false; c.material.depthWrite = true; } } });  
    setupAnimations(mesh, tpl.animations);
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.rotation.y = data.rotation;
    scene.add(mesh);
    monsters[data.id] = mesh;
    mesh.userData.targetPos = mesh.position.clone();
    mesh.userData.targetRot = data.rotation;
    FadeManager.fadeIn(mesh);
}

function checkCollision(position, direction, distance) {
    if(!environmentLayer) return false;
    tempOrigin.copy(position).y += 0.5;
    raycaster.set(tempOrigin, direction);
    const intersects = raycaster.intersectObjects(environmentLayer.children, true);
    return (intersects.length > 0 && intersects[0].distance < distance);
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
    FadeManager.update(delta);
    GroundItemManager.update(delta, scene);
    ParticleManager.update(delta, scene);
    ProjectileManager.update(delta, scene);

    if(myPlayer && !isMapLoading) {
        if(myPlayer.userData.mixer) myPlayer.userData.mixer.update(delta);
        if (frameCount % 10 === 0) updateDebug(currentMapConfig ? currentMapConfig.id : '', myPlayer.position, Object.keys(otherPlayers).length + 1, totalOnline);
        const isChatActive = getIsChatActive();

        if (isAttacking) {
            attackTimer -= delta; 
            if (attackTimer <= 0) {
                isAttacking = false;
                if ((!keys['f'] || isChatActive) && !isSitting) playAnim(myPlayer, 'IDLE');
            }
        }
        if (!isChatActive && keys['f'] && !isAttacking && (now - lastAttackTime > ATTACK_COOLDOWN)) {
             // Só repete ataque se for melee, ranged não repete automático pra evitar spam sem mira
             // Mas como simplificação, mantemos o performAttack
             performAttack(); 
             lastAttackTime = now;
        }

        let isMoving = false;
        if(!isChatActive && !isSitting && !isAttacking) { 
            tempVector.set(0, 0, 0);
            if(keys['w']) tempVector.z -= 1; if(keys['s']) tempVector.z += 1;
            if(keys['a']) tempVector.x -= 1; if(keys['d']) tempVector.x += 1;

            if(tempVector.lengthSq() > 0) {
                if (castingTimer) {
                    clearTimeout(castingTimer);
                    castingTimer = null;
                }                
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
                            myPlayer.position.x = nextX; myPlayer.position.z = nextZ;
                            isMoving = true;
                        }
                    }
                }
                const targetRot = Math.atan2(tempVector.x, tempVector.z);
                let diff = targetRot - myPlayer.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                myPlayer.rotation.y += diff * 0.2;
                playAnim(myPlayer, isRunning ? 'RUN' : 'WALK'); 
            } else {
                if(myPlayer.userData.current !== 'ATTACK' && myPlayer.userData.current !== 'SIT') playAnim(myPlayer, 'IDLE');
            }
        }
        tempOrigin.copy(myPlayer.position).add(new THREE.Vector3(0, 6, 7)); 
        camera.position.lerp(tempOrigin, 0.1);
        camera.lookAt(myPlayer.position.x, myPlayer.position.y + 1, myPlayer.position.z);

        if(now - lastPacketTime > 100) {
            let animToSend = 'IDLE';
            if (isAttacking) animToSend = 'ATTACK';
            else if (isSitting) animToSend = 'SIT';
            else if (isMoving) animToSend = keys['shift'] ? 'RUN' : 'WALK';
            socket.emit('player_update', { position: myPlayer.position, rotation: myPlayer.rotation.y, animation: animToSend });
            lastPacketTime = now;
        }
    }

    const LERP_SPEED = 6.0; const ROT_SPEED = 10.0;
    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (!p.userData.targetPos) continue;
        const dist = p.position.distanceTo(p.userData.targetPos);
        if (dist > 0.05) {
            const lerpFactor = Math.min(delta * LERP_SPEED, 1.0);
            p.position.lerp(p.userData.targetPos, lerpFactor);
        }
        p.quaternion.slerp(p.userData.targetQuat, Math.min(delta * ROT_SPEED, 1.0));
        const serverAnim = p.userData.serverAnimation;
        let finalAnim = 'IDLE';
        if (serverAnim === 'ATTACK' || serverAnim === 'SIT' || serverAnim === 'DEAD') { finalAnim = serverAnim; } 
        else { if (dist > 0.1) finalAnim = (serverAnim === 'RUN') ? 'RUN' : 'WALK'; }

        if (p.userData.currentAnimation !== finalAnim) {
            playAnim(p, finalAnim);
            p.userData.currentAnimation = finalAnim;
            if (finalAnim === 'ATTACK') p.userData.lastRemoteAttack = now;
        } else if (finalAnim === 'ATTACK') {
            const timeSinceLast = now - (p.userData.lastRemoteAttack || 0);
            if (timeSinceLast >= ATTACK_COOLDOWN) { playAnim(p, 'ATTACK'); p.userData.lastRemoteAttack = now; }
        }
        if(p.userData.mixer) p.userData.mixer.update(delta);
    }

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

    const activeTarget = monsters[currentTargetId] || otherPlayers[currentTargetId];
    
    if (targetRing) {
        if (activeTarget) {
            targetRing.visible = true;
            
            // CORREÇÃO DO GLITCH:
            // Se trocou de alvo, TELEPORTA o anel (sem deslizar)
            if (currentTargetId !== lastRenderedTargetId) {
                targetRing.position.copy(activeTarget.position);
                lastRenderedTargetId = currentTargetId;
            } else {
                // Se é o mesmo alvo se movendo, desliza suave
                targetRing.position.lerp(activeTarget.position, 0.2);
            }
            
            targetRing.position.y = 0.05;
        } else {
            targetRing.visible = false;
            lastRenderedTargetId = null;
        }
    }

    renderer.render(scene, camera);
}

window.requestDrop = (index, qtd) => { socket.emit('drop_item_request', { slotIndex: index, qtd: qtd }); };