// --- server.js ---

const { 
    LEVEL_TABLE, 
    BASE_ATTRIBUTES, 
    RESPAWN_POINT, 
    MAP_CONFIG, 
    MONSTER_TYPES, 
    ITEM_DATABASE, 
    EQUIP_SLOTS, 
    ITEM_TYPES,
    WEAPON_TYPES, // Novo
    SKILL_DATABASE // Novo (preparando para skills)
} = require('./modules/GameConfig');

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const Monster = require('./modules/Monster');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// --- PERSISTÊNCIA ---
const DATA_FILE = path.join(__dirname, 'data', 'accounts.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));

let accounts = {};
if (fs.existsSync(DATA_FILE)) {
    try { accounts = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } 
    catch (e) { accounts = {}; }
}

function saveAccounts() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
}

// --- ESTADO GLOBAL ---
const onlinePlayers = {};
const monsters = {};
const groundItems = {}; 
let groundItemCounter = 0; 

function spawnGroundItem(itemId, qtd, map, x, z) {
    groundItemCounter++;
    const uniqueId = `item_${groundItemCounter}`;
    const rX = x + (Math.random() * 0.5 - 0.25);
    const rZ = z + (Math.random() * 0.5 - 0.25);

    groundItems[uniqueId] = {
        uniqueId: uniqueId, itemId: itemId, qtd: qtd, map: map, x: rX, z: rZ,
        expiresAt: Date.now() + 40000 
    };
    io.to(map).emit('ground_item_spawn', groundItems[uniqueId]);
}

// --- FUNÇÕES AUXILIARES DE MATEMÁTICA ---
function getDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx*dx + dz*dz);
}

// Verifica se 'target' está na frente de 'attacker' (Cone de 160 graus aprox)
function isTargetInFront(attacker, target) {
    // Vetor direção do atacante (Baseado na rotação Y)
    // Em Three.js/Game Math, geralmente: X = sin(rot), Z = cos(rot)
    const dirX = Math.sin(attacker.rotation);
    const dirZ = Math.cos(attacker.rotation);

    // Vetor para o alvo (Normalizado)
    let toTargetX = target.position.x - attacker.position.x;
    let toTargetZ = target.position.z - attacker.position.z;
    const dist = Math.sqrt(toTargetX*toTargetX + toTargetZ*toTargetZ);
    
    if (dist === 0) return true; // Mesma posição
    
    toTargetX /= dist;
    toTargetZ /= dist;

    // Produto Escalar (Dot Product)
    const dot = (dirX * toTargetX) + (dirZ * toTargetZ);
    
    // > 0.2 é um cone bem generoso na frente. 
    return dot > 0.2; 
}

// --- FUNÇÕES DE RPG ---

function recalculateStats(socket) {
    let totalStr = socket.attributes.str;
    let totalAgi = socket.attributes.agi;
    let totalInt = socket.attributes.int;
    let totalVit = socket.attributes.vit;

    let bonusHp = 0, bonusMp = 0, bonusAtk = 0, bonusMatk = 0, bonusDef = 0, bonusEva = 0;

    if (socket.equipment) {
        Object.values(socket.equipment).forEach(itemId => {
            if (!itemId) return; 
            const itemData = ITEM_DATABASE[itemId];
            if (!itemData || !itemData.stats) return; 
            const s = itemData.stats;

            if(s.str) totalStr += s.str;
            if(s.agi) totalAgi += s.agi;
            if(s.int) totalInt += s.int;
            if(s.vit) totalVit += s.vit;

            if(s.hp) bonusHp += s.hp;
            if(s.mp) bonusMp += s.mp;
            if(s.atk) bonusAtk += s.atk;
            if(s.matk) bonusMatk += s.matk;
            if(s.def) bonusDef += s.def;
            if(s.eva) bonusEva += s.eva;
        });
    }

    const maxHp = 100 + (totalVit * 10) + bonusHp;
    const maxMp = 50 + (totalInt * 10) + bonusMp;
    const def = Math.floor(totalVit * 1) + bonusDef;
    const matk = Math.floor(totalInt * 2) + bonusMatk;
    const atk = 10 + (totalStr * 2) + bonusAtk;
    const eva = Math.floor((totalStr * 0.1) + (totalAgi * 0.5)) + bonusEva;
    const attackSpeed = Math.max(500, 2000 - (totalAgi * 20)); 

    socket.stats = {
        ...socket.stats,
        maxHp, maxMp, atk, matk, def, eva, attackSpeed,
        totalAttributes: { str: totalStr, agi: totalAgi, int: totalInt, vit: totalVit }
    };
    
    if (socket.stats.hp > maxHp) socket.stats.hp = maxHp;
    if (socket.stats.mp > maxMp) socket.stats.mp = maxMp;
}

function gainExperience(socket, amount) {
    socket.xp += amount;
    let leveledUp = false;
    while (socket.xp >= socket.nextLevelXp) {
        socket.xp -= socket.nextLevelXp;
        socket.level++;
        socket.pointsToDistribute += 3; 
        socket.nextLevelXp = LEVEL_TABLE[socket.level] || 999999;
        recalculateStats(socket);
        socket.stats.hp = socket.stats.maxHp;
        socket.stats.mp = socket.stats.maxMp;
        leveledUp = true;
    }
    if (leveledUp) {
        io.to(socket.map).emit('chat_message', { username: 'SISTEMA', message: `${socket.username} subiu para o nível ${socket.level}!`, type: 'system' });
        socket.emit('level_up_event', { level: socket.level });
    }
    sendStatsUpdate(socket);
}

function sendInventoryUpdate(socket) {
    socket.emit('inventory_update', { inventory: socket.inventory, equipment: socket.equipment });
    recalculateStats(socket); 
    sendStatsUpdate(socket);
}

function sendStatsUpdate(socket) {
    socket.emit('update_stats', {
        stats: socket.stats, level: socket.level, xp: socket.xp, nextLevelXp: socket.nextLevelXp,
        attributes: socket.attributes, points: socket.pointsToDistribute
    });
}

// --- LÓGICA DE JOGO ---

function handleMonsterAttack(monster, player) {
    monster.startAttack(); 
    
    const defense = player.stats.def || 0;
    const rawDmg = monster.config.dmg;
    const finalDmg = Math.max(1, rawDmg - (defense * 0.5)); 

    player.stats.hp = Math.max(0, player.stats.hp - finalDmg);
    
    io.to(monster.map).emit('monsters_update', [{ 
        id: monster.id, type: monster.type, position: monster.position, 
        rotation: monster.rotation, animation: 'ATTACK', hp: monster.hp 
    }]);

    io.to(monster.map).emit('damage_dealt', {
        targetId: player.id, attackerId: monster.id, damage: Math.floor(finalDmg), 
        newHp: player.stats.hp, isMonster: false 
    });

    if (player.stats.hp <= 0) handlePlayerDeath(player);
    else sendStatsUpdate(player);
}

function handleMonsterDeath(attacker, monster) {
    const type = monster.type;
    const mapId = monster.map;
    const mobConfig = MONSTER_TYPES[type];
    
    // 1. Drops
    if (mobConfig.drops) {
        mobConfig.drops.forEach(drop => {
            if (Math.random() * 100 <= drop.chance) {
                spawnGroundItem(drop.itemId, 1, mapId, monster.position.x, monster.position.z);
            }
        });
    }

    // 2. Remove da lista global
    delete monsters[monster.id];
    
    // 3. Avisa todos que morreu (O cliente remove o modelo aqui)
    io.to(mapId).emit('monster_dead', monster.id);
    
    // 4. Recompensas
    if (onlinePlayers[attacker.id]) {
        attacker.stats.cash += 10; // Exemplo de gold
        gainExperience(attacker, mobConfig.xp || 20);
    }

    // 5. Agendar Respawn
    scheduleMonsterRespawn(type, mapId);
}

function handlePlayerDeath(player) {
    player.stats.hp = player.stats.maxHp;
    player.stats.mp = player.stats.maxMp;
    player.animation = 'IDLE';
    Object.values(monsters).forEach(m => { if(m.targetId === player.id) m.targetId = null; });

    io.to(player.map).emit('chat_message', { username: 'SISTEMA', message: `${player.username} desmaiou!`, type: 'system' });
    sendStatsUpdate(player); 
    switchMap(player, RESPAWN_POINT.map, RESPAWN_POINT.x, RESPAWN_POINT.z);
    player.emit('player_respawned', { message: 'Você renasceu no vilarejo.' });
}

function scheduleMonsterRespawn(type, mapId) {
    setTimeout(() => {
        const mapData = MAP_CONFIG[mapId];
        if(!mapData) return;
        const spawnConfig = mapData.monsterSpawns.find(s => s.type === type);
        if(!spawnConfig) return;

        const typeCount = Object.values(monsters).filter(m => m.map === mapId && m.type === type).length;
        if(typeCount >= spawnConfig.count) return;

        const angle = Math.random() * 6.28;
        const r = Math.random() * spawnConfig.area.radius;
        let x = spawnConfig.area.x + Math.cos(angle) * r;
        let z = spawnConfig.area.z + Math.sin(angle) * r;
        
        const limit = (mapData.mapSize / 2) - 2.0; 
        if (x > limit) x = limit; if (x < -limit) x = -limit;
        if (z > limit) z = limit; if (z < -limit) z = -limit;

        const mob = new Monster(type, x, z, mapId);
        monsters[mob.id] = mob;
        io.to(mapId).emit('monster_spawn', mob);
    }, 5000);
}

function spawnInitialMonsters() {
    Object.values(MAP_CONFIG).forEach(mapData => {
        if (!mapData.monsterSpawns) return;
        mapData.monsterSpawns.forEach(spawn => {
            const currentTypeCount = Object.values(monsters).filter(m => m.map === mapData.id && m.type === spawn.type).length;
            if(currentTypeCount < spawn.count) {
                const missing = spawn.count - currentTypeCount;
                for(let i=0; i < missing; i++) scheduleMonsterRespawn(spawn.type, mapData.id);
            }
        });
    });
}

function savePlayerState(socket) {
    if (!socket.username || !accounts[socket.username]) return;
    accounts[socket.username].data = {
        map: socket.map, position: socket.position, stats: socket.stats,
        level: socket.level, xp: socket.xp, points: socket.pointsToDistribute, 
        attributes: socket.attributes, inventory: socket.inventory, equipment: socket.equipment
    };
    saveAccounts();
}

function getPublicPlayerData(socket) {
    return {
        id: socket.id, username: socket.username, position: socket.position,
        rotation: socket.rotation, animation: socket.animation,
        hp: socket.stats.hp, maxHp: socket.stats.maxHp, stats: socket.stats
    };
}

function switchMap(socket, newMapId, x, z) {
    savePlayerState(socket);
    const oldMap = socket.map;
    
    socket.leave(oldMap);
    socket.broadcast.to(oldMap).emit('player_left', socket.id);

    socket.map = newMapId;
    socket.position = { x, y: 0, z };
    socket.join(newMapId);

    const mapPlayers = {};
    const mapMonsters = {};
    const mapGroundItems = {};
    
    Object.values(onlinePlayers).forEach(p => { if(p.map === newMapId && p.id !== socket.id) mapPlayers[p.id] = getPublicPlayerData(p); });
    Object.values(monsters).forEach(m => { if(m.map === newMapId) mapMonsters[m.id] = m; });
    Object.values(groundItems).forEach(i => { if(i.map === newMapId) mapGroundItems[i.uniqueId] = i; });

    socket.emit('map_changed', {
        mapConfig: MAP_CONFIG[newMapId], playerData: getPublicPlayerData(socket),
        mapPlayers: mapPlayers, mapMonsters: mapMonsters, mapGroundItems: mapGroundItems
    });

    socket.broadcast.to(newMapId).emit('player_joined', getPublicPlayerData(socket));
}

// --- GAME LOOP ---
setInterval(() => {
    const now = Date.now();
    const updates = {}; 
    const deadMonsters = [];

    Object.values(monsters).forEach(m => {
        if (m.hp > 0) { 
            m.update(100, onlinePlayers, { onAttack: (monster, target) => handleMonsterAttack(monster, target) });
            if(!updates[m.map]) updates[m.map] = [];
            
            updates[m.map].push({ 
                id: m.id, type: m.type, 
                position: { x: parseFloat(m.position.x.toFixed(3)), y: 0, z: parseFloat(m.position.z.toFixed(3)) }, 
                rotation: parseFloat(m.rotation.toFixed(3)), animation: m.animation, hp: m.hp 
            });
        } else {
            deadMonsters.push(m.id);
        }
    });

    deadMonsters.forEach(id => {
        const m = monsters[id];
        if(m) { delete monsters[id]; io.to(m.map).emit('monster_dead', id); }
    });

    Object.keys(updates).forEach(mapId => { io.to(mapId).emit('monsters_update', updates[mapId]); });
    if(Math.random() < 0.05) spawnInitialMonsters();

    Object.values(groundItems).forEach(item => {
        if (now > item.expiresAt) {
            delete groundItems[item.uniqueId];
            io.to(item.map).emit('ground_item_expire', item.uniqueId); 
        }
    });
}, 100);

setInterval(() => { io.emit('server_stats', { total: Object.keys(onlinePlayers).length }); }, 2000);

// --- CONEXÕES SOCKET ---
io.on('connection', (socket) => {
    
    socket.on('register', (data) => {
        if (accounts[data.username]) socket.emit('login_error', 'Usuário já existe.');
        else {
            accounts[data.username] = { 
                password: data.password, 
                data: { 
                    map: 'vilarejo', position: { x: 0, y: 0, z: 0 }, 
                    stats: { hp: 100, mp: 50, cash: 0 },
                    inventory: [], 
                    equipment: { weapon: null, armor: null, head: null, legs: null, accessory: null },
                    level: 1, xp: 0, points: 0, attributes: { ...BASE_ATTRIBUTES }
                } 
            };
            saveAccounts(); 
            socket.emit('register_success', 'Conta criada!');
        }
    });

    socket.on('login', (data) => {
        const account = accounts[data.username];
        if (account && account.password === data.password) {
            const existing = Object.values(onlinePlayers).find(p => p.username === data.username);
            if(existing) { existing.disconnect(); delete onlinePlayers[existing.id]; }

            const savedData = account.data;
            socket.username = data.username;
            socket.map = savedData.map;
            socket.position = savedData.position;
            socket.rotation = 0; 
            socket.animation = 'IDLE';

            socket.level = savedData.level || 1;
            socket.xp = savedData.xp || 0;
            socket.pointsToDistribute = savedData.points || 0;
            socket.attributes = savedData.attributes || { ...BASE_ATTRIBUTES };
            socket.inventory = savedData.inventory || [];
            socket.equipment = savedData.equipment || { weapon: null, armor: null, head: null, legs: null, accessory: null };            
            socket.nextLevelXp = LEVEL_TABLE[socket.level] || 100;
            socket.stats = { ...savedData.stats };
            socket.cooldowns = {}; // Armazena timestamp de quando a skill estará pronta
            socket.isCasting = false;
            socket.castTimeout = null;

            recalculateStats(socket);
            
            onlinePlayers[socket.id] = socket;
            socket.join(socket.map);

            const mapPlayers = {};
            Object.values(onlinePlayers).forEach(p => { if(p.map === socket.map && p.id !== socket.id) mapPlayers[p.id] = getPublicPlayerData(p); });
            const mapMonsters = {};
            Object.values(monsters).forEach(m => { if(m.map === socket.map) mapMonsters[m.id] = m; });
            const mapGroundItems = {};
            Object.values(groundItems).forEach(i => { if(i.map === socket.map) mapGroundItems[i.uniqueId] = i; });

            const myData = getPublicPlayerData(socket);
            myData.level = socket.level;
            myData.xp = socket.xp;
            myData.nextLevelXp = socket.nextLevelXp;
            myData.points = socket.pointsToDistribute;
            myData.attributes = socket.attributes;

            socket.emit('login_success', {
                playerId: socket.id, playerData: myData, mapConfig: MAP_CONFIG[socket.map],
                mapPlayers: mapPlayers, mapMonsters: mapMonsters, mapGroundItems: mapGroundItems,
                monsterTypes: MONSTER_TYPES, itemDB: ITEM_DATABASE, skillDB: SKILL_DATABASE,
                inventory: socket.inventory, equipment: socket.equipment
            });
            socket.broadcast.to(socket.map).emit('player_joined', getPublicPlayerData(socket));
        } else {
            socket.emit('login_error', 'Dados incorretos.');
        }
    });

    socket.on('player_update', (data) => {
        if (!onlinePlayers[socket.id]) return;
        // Se o jogador se moveu significativamente e está castando
        if (onlinePlayers[socket.id].isCasting) {
            const dist = getDistance(data.position, onlinePlayers[socket.id].position);
            if (dist > 0.1) { // Tolerância mínima
                clearTimeout(onlinePlayers[socket.id].castTimeout);
                onlinePlayers[socket.id].isCasting = false;
                io.to(socket.map).emit('cast_interrupted', socket.id);
                socket.emit('chat_message', { username: 'SISTEMA', message: 'Conjuração cancelada!', type: 'system' });
            }
        }

        const mapConfig = MAP_CONFIG[socket.map];
        if (!mapConfig) return;

        const limit = mapConfig.mapSize / 2;
        if (Math.abs(data.position.x) > limit || Math.abs(data.position.z) > limit) return;

        socket.position = data.position;
        socket.rotation = data.rotation;
        socket.animation = data.animation;
        
        socket.broadcast.to(socket.map).emit('player_moved', { 
            id: socket.id, username: socket.username, position: data.position, rotation: data.rotation, animation: data.animation 
        });

        if (mapConfig.portals) {
            mapConfig.portals.forEach(portal => {
                const dx = socket.position.x - portal.x;
                const dz = socket.position.z - portal.z;
                if (Math.sqrt(dx*dx + dz*dz) < portal.radius) switchMap(socket, portal.targetMap, portal.targetX, portal.targetZ);
            });
        }
    });

    socket.on('distribute_points', (newAttributes) => {
        if (!onlinePlayers[socket.id]) return;
        const currentTotal = Object.values(socket.attributes).reduce((a, b) => a + b, 0);
        const newTotal = Object.values(newAttributes).reduce((a, b) => a + b, 0);
        const diff = newTotal - currentTotal;

        if (diff > 0 && diff <= socket.pointsToDistribute) {
            socket.attributes = newAttributes;
            socket.pointsToDistribute -= diff;
            recalculateStats(socket);
            savePlayerState(socket);
            sendStatsUpdate(socket);
        }
    });    

socket.on('attack_request', (targetId) => {
        if (!onlinePlayers[socket.id]) return;
        const attacker = onlinePlayers[socket.id];
        
        let weaponId = attacker.equipment.weapon;
        let weaponData = weaponId ? ITEM_DATABASE[weaponId] : null;
        
        // --- MUDANÇA: Range padrão mais curto ---
        let attackRange = 1.0; // 1.0m é o range padrão para ataques corpo a corpo sem arma
        let isRanged = false;
        
        if (weaponData) {
            if (weaponData.range) attackRange = weaponData.range;
            if (weaponData.weaponType === WEAPON_TYPES.RANGED) isRanged = true;
        }

        let target = null;
        let isMonsterTarget = false;

        // ... (lógica de achar target pelo ID continua igual) ...
        if (targetId) {
            if (monsters[targetId] && monsters[targetId].map === attacker.map && monsters[targetId].hp > 0) {
                target = monsters[targetId];
                isMonsterTarget = true;
            } else if (onlinePlayers[targetId] && onlinePlayers[targetId].map === attacker.map && MAP_CONFIG[attacker.map].pvp) {
                target = onlinePlayers[targetId];
                isMonsterTarget = false;
            }
        }

        // Auto-aim melee fallback (Servidor)
        // Reduzimos o raio de busca automática para ficar bem colado
        if (!target && !isRanged) {
            let bestDistSq = Infinity;
            const MELEE_AUTOAIM_RADIUS = 1.8; // Máximo 1.8m para "grudar" sozinho
            const MELEE_AUTOAIM_SQ = MELEE_AUTOAIM_RADIUS * MELEE_AUTOAIM_RADIUS;

            Object.values(monsters).forEach(m => {
                if (m.map !== attacker.map || m.hp <= 0) return;
                const distSq = getDistance(m.position, attacker.position); // getDistance retorna SQRT? NÃO.
                // ATENÇÃO: Verifique sua função getDistance no topo do server.js
                // Se ela faz Math.sqrt, compare com MELEE_AUTOAIM_RADIUS.
                // Assumindo que sua getDistance FAZ sqrt:
                if (distSq <= MELEE_AUTOAIM_RADIUS && distSq < bestDistSq) { 
                    target = m; bestDistSq = distSq; isMonsterTarget = true;
                }
            });
        }

        if (target) {
            const dist = getDistance(target.position, attacker.position);
            
            // --- MUDANÇA: Tolerância ZERO para melee ---
            // Se for Ranged, aceita 1m de lag. Se for Melee, aceita 0.2m.
            const tolerance = isRanged ? 1.0 : 0.2;
            
            if (dist > attackRange + tolerance) {
                 // Dica: Descomente para debugar se estiver falhando muito
                 // console.log(`Falha Range: Dist ${dist} > Max ${attackRange + tolerance}`);
                 return; 
            }
            if (isRanged && !isTargetInFront(attacker, target)) return;

            const baseDmg = attacker.stats.atk || 10;
            const variation = (Math.random() * 0.2) + 0.9; 
            const dmg = Math.floor(baseDmg * variation);
            let currentHp = 0;
            let realTargetId = target.id; // Guarda ID antes de deletar

            // 1. Aplica Dano
            if (isMonsterTarget) {
                currentHp = target.takeDamage(dmg, attacker.id);
            } else {
                const targetDef = target.stats.def || 0;
                const pvpDmg = Math.max(1, dmg - (targetDef * 0.5));
                target.stats.hp = Math.max(0, target.stats.hp - pvpDmg);
                currentHp = target.stats.hp;
            }

            // 2. CRUCIAL: Envia visuais ANTES de processar morte
            io.to(attacker.map).emit('damage_dealt', {
                targetId: realTargetId, attackerId: attacker.id, damage: dmg, newHp: currentHp, isMonster: isMonsterTarget, x: target.position.x, z: target.position.z
            });

            if (isRanged) {
                io.to(attacker.map).emit('projectile_fired', {
                    shooterId: attacker.id, targetId: realTargetId, type: 'ARROW'
                });
            }

            // 3. Processa Morte (se houver)
            if (currentHp <= 0) {
                if (isMonsterTarget) {
                    handleMonsterDeath(attacker, target);
                } else {
                    handlePlayerDeath(target);
                }
            } else {
                if (!isMonsterTarget) sendStatsUpdate(target);
            }
        }
    });

    socket.on('use_item', (slotIndex) => {
        if (!socket.inventory[slotIndex]) return;
        
        const item = socket.inventory[slotIndex];
        const dbItem = ITEM_DATABASE[item.id];
        if (!dbItem) return;

        if (dbItem.type === ITEM_TYPES.EQUIPMENT) {
            const slot = dbItem.slot;
            const currentEquippedId = socket.equipment[slot];
            socket.equipment[slot] = item.id;
            socket.inventory.splice(slotIndex, 1);
            if (currentEquippedId) {
                socket.inventory.push({ id: currentEquippedId, qtd: 1 });
            }
            sendInventoryUpdate(socket);
        }
        else if (dbItem.type === ITEM_TYPES.CONSUMABLE) {
            let vfxType = null;
            if (dbItem.effect.hp) {
                socket.stats.hp = Math.min(socket.stats.maxHp, socket.stats.hp + dbItem.effect.hp);
                vfxType = 'POTION_HP'; 
            }
            if (dbItem.effect.mp) {
                socket.stats.mp = Math.min(socket.stats.maxMp, socket.stats.mp + dbItem.effect.mp);
                vfxType = 'POTION_MP';
            }
            
            item.qtd--;
            if (item.qtd <= 0) socket.inventory.splice(slotIndex, 1);
            sendInventoryUpdate(socket);

            if (vfxType) {
                io.to(socket.map).emit('play_vfx', { targetId: socket.id, type: vfxType });
            }
        }
    });

    socket.on('unequip_item', (slotName) => {
        const itemId = socket.equipment[slotName];
        if (!itemId) return;
        socket.equipment[slotName] = null;
        socket.inventory.push({ id: itemId, qtd: 1 });
        sendInventoryUpdate(socket);
    });    

    socket.on('drop_item_request', (data) => {
        if (!socket.inventory[data.slotIndex]) return;
        const item = socket.inventory[data.slotIndex];
        if (data.qtd <= 0 || data.qtd > item.qtd) return;
        spawnGroundItem(item.id, data.qtd, socket.map, socket.position.x, socket.position.z);
        item.qtd -= data.qtd;
        if (item.qtd <= 0) socket.inventory.splice(data.slotIndex, 1);
        sendInventoryUpdate(socket);
    });

    socket.on('pickup_request', (uniqueId) => {
        const gItem = groundItems[uniqueId];
        if (!gItem || gItem.map !== socket.map) return;
        const dx = socket.position.x - gItem.x;
        const dz = socket.position.z - gItem.z;
        if (dx*dx + dz*dz > 4.0) return; // Aumentei raio de pickup para 2m (4m²)

        const itemConfig = ITEM_DATABASE[gItem.itemId];
        const isEquip = itemConfig.type === ITEM_TYPES.EQUIPMENT;
        const existing = socket.inventory.find(i => i.id === gItem.itemId);

        if (existing && !isEquip) {
            existing.qtd += gItem.qtd;
        } else {
            socket.inventory.push({ id: gItem.itemId, qtd: gItem.qtd });
        }

        delete groundItems[uniqueId];
        io.to(socket.map).emit('ground_item_remove', uniqueId);
        sendInventoryUpdate(socket);
    });

    socket.on('chat_message', (msg) => {
        if (msg.startsWith('/give ')) {
            const parts = msg.split(' ');
            const id = parseInt(parts[1]);
            const qtd = parseInt(parts[2]) || 1;
            
            if (ITEM_DATABASE[id]) {
                const existing = socket.inventory.find(i => i.id === id);
                const isEquip = ITEM_DATABASE[id].type === ITEM_TYPES.EQUIPMENT;
                
                if (existing && !isEquip) {
                    existing.qtd += qtd;
                } else {
                    socket.inventory.push({ id: id, qtd: qtd });
                }
                
                sendInventoryUpdate(socket);
                socket.emit('chat_message', { username: 'SISTEMA', message: `Você recebeu: ${ITEM_DATABASE[id].name}`, type: 'system' });
                return;
            }
        }
        if(onlinePlayers[socket.id]) io.to(socket.map).emit('chat_message', { username: socket.username, message: msg, id: socket.id });
    });

// --- SISTEMA DE SKILLS ---
    socket.on('use_skill', (data) => {
        const player = onlinePlayers[socket.id];
        if (!player || player.stats.hp <= 0) return;

        const skill = SKILL_DATABASE[data.skillId];
        if (!skill) return;

        // 1. Validações de Recarga e Mana
        const now = Date.now();
        const cdReady = player.cooldowns[data.skillId] || 0;
        if (now < cdReady) {
            socket.emit('chat_message', { username: 'SISTEMA', message: 'Habilidade em recarga.', type: 'system' });
            return;
        }
        if (player.stats.mp < skill.manaCost) {
            socket.emit('chat_message', { username: 'SISTEMA', message: 'Mana insuficiente.', type: 'system' });
            return;
        }

        // 2. Resolução de Alvo (Lógica Unificada com Auto-Aim)
        let target = null;

        // A) Tenta usar o alvo enviado pelo cliente
        if (data.targetId) {
            if (monsters[data.targetId] && monsters[data.targetId].map === player.map && monsters[data.targetId].hp > 0) target = monsters[data.targetId];
            else if (onlinePlayers[data.targetId] && onlinePlayers[data.targetId].map === player.map) target = onlinePlayers[data.targetId];
        }

        // B) Se não tem alvo válido e a skill NÃO é de Suporte (Support sem alvo = Self), tenta Auto-Target (igual ataque básico)
        if (!target && skill.type !== 'SUPPORT' && skill.type !== 'AREA') {
            let bestDistSq = Infinity;
            // Define alcance do auto-aim baseado na skill (Melee busca perto, Ranged busca longe)
            const AUTO_AIM_RANGE = skill.type === 'MELEE' ? 3.0 : 12.0; 
            const AUTO_AIM_SQ = AUTO_AIM_RANGE * AUTO_AIM_RANGE;

            Object.values(monsters).forEach(m => {
                if (m.map !== player.map || m.hp <= 0) return;
                const distSq = getDistance(m.position, player.position); // Requer Math.pow ou dx*dx
                // Como getDistance retorna raiz, elevamos ao quadrado para comparar ou usamos direto:
                // Nota: getDistance retorna float.
                if (distSq * distSq <= AUTO_AIM_SQ && distSq < bestDistSq) {
                     // Verifica angulo se for ranged
                     if (skill.type === 'CASTING' || skill.type === 'INSTANT') {
                         if (isTargetInFront(player, m)) {
                             target = m; bestDistSq = distSq;
                         }
                     } else {
                         // Melee pega qualquer um em volta
                         target = m; bestDistSq = distSq;
                     }
                }
            });
        }

        // C) Lógica Específica de Support (Auto-Self)
        if (skill.type === 'SUPPORT') {
            if (!target) {
                target = player; // Cura a si mesmo se não tiver alvo
            } else {
                // Se o alvo for um monstro, muda para si mesmo (não curar monstros!)
                if (monsters[target.id]) target = player;
            }
        }

        // Validação Final: Precisa de alvo? (Area não precisa)
        if (!target && skill.type !== 'AREA') {
             socket.emit('chat_message', { username: 'SISTEMA', message: 'Nenhum alvo encontrado.', type: 'system' });
             return;
        }

        // 3. Validações de Distância
        if (target) {
            const dist = getDistance(player.position, target.position);
            // Se for self-cast (distancia 0), ignora check de range
            if (target.id !== player.id) {
                if (dist > skill.range + 1.5) { // Tolerância aumentada
                    socket.emit('chat_message', { username: 'SISTEMA', message: 'Alvo fora de alcance.', type: 'system' });
                    return;
                }
                
                // Validação de Ângulo (Só para ofensivas a distância)
                if (skill.type === 'CASTING' || (skill.type === 'INSTANT' && skill.range > 5)) {
                    if (!isTargetInFront(player, target)) {
                        socket.emit('chat_message', { username: 'SISTEMA', message: 'Precisa estar de frente.', type: 'system' });
                        return;
                    }
                }
            }
        }

        // --- FUNÇÃO DE EXECUÇÃO ---
        const executeSkill = () => {
            if (!onlinePlayers[socket.id] || onlinePlayers[socket.id].stats.hp <= 0) return;

            // Consumo
            player.stats.mp -= skill.manaCost;
            player.cooldowns[data.skillId] = Date.now() + skill.cooldown;

            // --- TIPO: CASTING (Bola de Fogo) ---
            if (skill.type === 'CASTING' && target) {
                 // Verifica se alvo morreu no delay
                 let exists = monsters[target.id] || onlinePlayers[target.id];
                 if (!exists) {
                     socket.emit('chat_message', { username: 'SISTEMA', message: 'Alvo desapareceu.', type: 'system' });
                     player.isCasting = false;
                     sendStatsUpdate(player);
                     return;
                 }

                 const magicAttack = Number(player.stats.matk || 10);
                 let dmg = skill.damage + magicAttack; 
                 let finalHp = 0;
                 let isMonster = !!monsters[target.id];
                 let realTargetId = target.id;

                 if (isMonster) {
                     finalHp = target.takeDamage(dmg, player.id);
                 } else {
                     // PVP Dano
                     let currentHp = Number(target.stats.hp);
                     target.stats.hp = Math.max(0, currentHp - dmg);
                     finalHp = target.stats.hp;
                 }

                 io.to(player.map).emit('damage_dealt', {
                    targetId: realTargetId, attackerId: player.id, damage: dmg, newHp: finalHp, isMonster: isMonster,
                    x: parseFloat(target.position.x), z: parseFloat(target.position.z)
                 });
                 
                 let projType = (data.skillId === 'fireball') ? 'FIREBALL' : 'ARROW';
                 io.to(player.map).emit('projectile_fired', {
                    shooterId: player.id, targetId: realTargetId, type: projType
                 });

                 if (finalHp <= 0) {
                     if (isMonster) handleMonsterDeath(player, target);
                     else handlePlayerDeath(target);
                 } else {
                     if (!isMonster) sendStatsUpdate(target);
                 }
            }

            // --- TIPO: MELEE (Golpe Feroz) ---
            else if (skill.type === 'MELEE' && target) {
                // Animação
                socket.broadcast.to(player.map).emit('player_update', { 
                    id: player.id, position: player.position, rotation: player.rotation, animation: 'ATTACK' 
                });
                
                let physDmg = skill.damage + Number(player.stats.atk || 10);
                let finalHp = 0;
                let isMonster = !!monsters[target.id];
                
                if (isMonster) {
                    finalHp = target.takeDamage(physDmg, player.id);
                } else {
                    let def = Number(target.stats.def || 0);
                    let currentHp = Number(target.stats.hp);
                    let finalDmg = Math.max(1, physDmg - (def * 0.5));
                    target.stats.hp = Math.max(0, currentHp - finalDmg);
                    finalHp = target.stats.hp;
                }

                io.to(player.map).emit('damage_dealt', {
                    targetId: target.id, attackerId: player.id, damage: Math.floor(physDmg), newHp: finalHp, isMonster: isMonster,
                    x: parseFloat(target.position.x), z: parseFloat(target.position.z)
                });

                if (finalHp <= 0) {
                    if (isMonster) handleMonsterDeath(player, target);
                    else handlePlayerDeath(target);
                } else {
                    if (!isMonster) sendStatsUpdate(target);
                }
            }

            // --- TIPO: SUPPORT (Cura) ---
            else if (skill.type === 'SUPPORT' && target) {
                // CORREÇÃO MATEMÁTICA E LÓGICA
                if (skill.effect && skill.effect.hp) {
                    // Garante números
                    let healBase = Number(skill.effect.hp);
                    let bonusInt = Number(player.stats.int || 0) * 3;
                    let healAmount = healBase + bonusInt;
                    
                    let currentHp = Number(target.stats.hp);
                    let maxHp = Number(target.stats.maxHp);
                    
                    // Aplica cura
                    let newHp = currentHp + healAmount;
                    if (newHp > maxHp) newHp = maxHp;
                    
                    target.stats.hp = newHp;
                    
                    // Visual
                    io.to(player.map).emit('play_vfx', { targetId: target.id, type: 'POTION_HP' });

                    // Log para quem curou
                    socket.emit('chat_message', { 
                        username: 'SISTEMA', 
                        message: `Curou ${healAmount} HP de ${target.username || 'Monstro(?!)'}.`, 
                        type: 'system' 
                    });

                    // Atualiza o alvo (se for player)
                    if (onlinePlayers[target.id]) {
                        sendStatsUpdate(target);
                        if (target.id !== player.id) {
                            // Avisa o alvo que foi curado
                            target.emit('chat_message', { 
                                username: 'SISTEMA', 
                                message: `${player.username} curou você.`, 
                                type: 'system' 
                            });
                        }
                    }
                }
            }
            // --- TIPO: AREA (Meteoro) ---
            else if (skill.type === 'AREA') {
                // Validações
                if (data.x === undefined || data.z === undefined) return;
                
                const targetPos = { x: data.x, z: data.z };
                
                // Valida Distância do Cast (Eu posso jogar o meteoro tão longe?)
                const distToCenter = getDistance(player.position, targetPos);
                if (distToCenter > skill.range + 2.0) {
                    socket.emit('chat_message', { username: 'SISTEMA', message: 'Área muito distante.', type: 'system' });
                    return;
                }

                // Animação de Cast
                socket.broadcast.to(player.map).emit('player_update', { 
                    id: player.id, position: player.position, rotation: player.rotation, animation: 'ATTACK' 
                });

                // Efeito Visual da Explosão (Novo tipo: METEOR)
                io.to(player.map).emit('play_vfx', {
                    x: targetPos.x,
                    z: targetPos.z,
                    type: 'METEOR_EXPLOSION'
                });

                // CÁLCULO DE ÁREA
                const radiusSq = skill.radius * skill.radius;
                const magicDmg = skill.damage + (player.stats.matk || 10);

                // 1. Monstros na área
                Object.values(monsters).forEach(m => {
                    if (m.map !== player.map || m.hp <= 0) return;
                    
                    const distSq = (m.position.x - targetPos.x)**2 + (m.position.z - targetPos.z)**2;
                    
                    if (distSq <= radiusSq) {
                        // Acertou!
                        let finalHp = m.takeDamage(magicDmg, player.id);
                        
                        io.to(player.map).emit('damage_dealt', {
                            targetId: m.id, attackerId: player.id, damage: magicDmg, newHp: finalHp, isMonster: true,
                            x: m.position.x, z: m.position.z
                        });

                        if (finalHp <= 0) handleMonsterDeath(player, m);
                    }
                });

                // 2. Players na área (PVP)
                if (MAP_CONFIG[player.map].pvp) {
                    Object.values(onlinePlayers).forEach(p => {
                        if (p.map !== player.map || p.id === player.id || p.stats.hp <= 0) return;
                        
                        const distSq = (p.position.x - targetPos.x)**2 + (p.position.z - targetPos.z)**2;
                        
                        if (distSq <= radiusSq) {
                            let def = p.stats.def || 0;
                            let finalDmg = Math.max(1, magicDmg - (def * 0.5));
                            p.stats.hp = Math.max(0, p.stats.hp - finalDmg);
                            
                            io.to(player.map).emit('damage_dealt', {
                                targetId: p.id, attackerId: player.id, damage: Math.floor(finalDmg), newHp: p.stats.hp, isMonster: false,
                                x: p.position.x, z: p.position.z
                            });

                            if (p.stats.hp <= 0) handlePlayerDeath(p);
                            else sendStatsUpdate(p);
                        }
                    });
                }
            }            

            sendStatsUpdate(player);
            player.isCasting = false;
        };

        if (skill.castTime > 0) {
            player.isCasting = true;
            io.to(player.map).emit('cast_start', { id: player.id, skillName: skill.name, time: skill.castTime });
            player.castTimeout = setTimeout(() => {
                if (player.isCasting) executeSkill();
            }, skill.castTime);
        } else {
            executeSkill();
        }
    });

    socket.on('disconnect', () => {
        if (onlinePlayers[socket.id]) {
            savePlayerState(socket);
            socket.broadcast.to(socket.map).emit('player_left', socket.id);
            Object.values(monsters).forEach(m => { if(m.targetId === socket.id) m.targetId = null; });
            delete onlinePlayers[socket.id];
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Servidor RPG rodando na porta ${PORT}`));