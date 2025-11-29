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
        attributes: socket.attributes, inventory: socket.inventory, equipment: socket.equipment, 
        hotbar: socket.hotbar
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
            socket.hotbar = savedData.hotbar || [null, null, null, null, null, null];       
            socket.nextLevelXp = LEVEL_TABLE[socket.level] || 100;
            socket.stats = { ...savedData.stats };
            socket.cooldowns = {}; // Armazena timestamp de quando a skill estará pronta
            socket.itemCooldowns = {};
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
                inventory: socket.inventory, equipment: socket.equipment, hotbar: socket.hotbar,
                // Enviando constantes para o cliente evitar erros de digitação:
                weaponTypes: WEAPON_TYPES, itemTypes: ITEM_TYPES 
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
        const mapData = MAP_CONFIG[attacker.map]; // Pega dados do mapa
        
        let weaponId = attacker.equipment.weapon;
        let weaponData = weaponId ? ITEM_DATABASE[weaponId] : null;
        
        let attackRange = 1.0; 
        let isRanged = false;
        
        if (weaponData) {
            if (weaponData.range) attackRange = weaponData.range;
            if (weaponData.weaponType === WEAPON_TYPES.RANGED) isRanged = true;
        }

        let target = null;
        let isMonsterTarget = false;

        if (targetId) {
            if (monsters[targetId] && monsters[targetId].map === attacker.map && monsters[targetId].hp > 0) {
                target = monsters[targetId];
                isMonsterTarget = true;
            } else if (onlinePlayers[targetId] && onlinePlayers[targetId].map === attacker.map) {
                // CORREÇÃO PVP: Se for player, só aceita como alvo se PVP estiver ligado
                if (mapData.pvp) {
                    target = onlinePlayers[targetId];
                    isMonsterTarget = false;
                }
            }
        }

        // Auto-aim melee fallback (Servidor)
        if (!target && !isRanged) {
            let bestDistSq = Infinity;
            const MELEE_AUTOAIM_RADIUS = 1.8; 

            Object.values(monsters).forEach(m => {
                if (m.map !== attacker.map || m.hp <= 0) return;
                const dist = getDistance(m.position, attacker.position); // Assumindo que getDistance retorna float
                if (dist <= MELEE_AUTOAIM_RADIUS && dist < bestDistSq) { 
                    target = m; bestDistSq = dist; isMonsterTarget = true;
                }
            });
        }

        if (target) {
            const dist = getDistance(target.position, attacker.position);
            const tolerance = isRanged ? 1.0 : 0.5; // Tolerância ajustada
            
            if (dist > attackRange + tolerance) return; 
            if (isRanged && !isTargetInFront(attacker, target)) return;

            // --- BLOQUEIO FINAL DE PVP (Segurança Dupla) ---
            if (!isMonsterTarget && !mapData.pvp) {
                socket.emit('chat_message', { username: 'SISTEMA', message: 'PVP desativado neste local.', type: 'system' });
                return;
            }

            const baseDmg = attacker.stats.atk || 10;
            const variation = (Math.random() * 0.2) + 0.9; 
            const dmg = Math.floor(baseDmg * variation);
            let currentHp = 0;
            let realTargetId = target.id; 

            // 1. Aplica Dano
            if (isMonsterTarget) {
                currentHp = target.takeDamage(dmg, attacker.id);
            } else {
                const targetDef = target.stats.def || 0;
                const pvpDmg = Math.max(1, dmg - (targetDef * 0.5));
                target.stats.hp = Math.max(0, target.stats.hp - pvpDmg);
                currentHp = target.stats.hp;
            }

            // 2. Envia visuais
            io.to(attacker.map).emit('damage_dealt', {
                targetId: realTargetId, 
                attackerId: attacker.id, 
                damage: dmg, 
                newHp: currentHp, 
                isMonster: isMonsterTarget, 
                x: target.position.x, 
                z: target.position.z,
                dmgType: 'BASIC' // <--- NOVO
            });

            if (isRanged) {
                // Aqui você pode melhorar pegando o tipo do projétil da arma no futuro, por enquanto ARROW
                io.to(attacker.map).emit('projectile_fired', {
                    shooterId: attacker.id, targetId: realTargetId, type: 'ARROW'
                });
            }

            // 3. Processa Morte
            if (currentHp <= 0) {
                if (isMonsterTarget) handleMonsterDeath(attacker, target);
                else handlePlayerDeath(target);
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

        // --- VALIDAÇÃO DE COOLDOWN DE ITEM ---
        if (dbItem.cooldown) {
            const now = Date.now();
        if (!socket.itemCooldowns) socket.itemCooldowns = {}; 
        const lastUse = socket.itemCooldowns[dbItem.id] || 0;
            if (now < lastUse) {
                socket.emit('chat_message', { username: 'SISTEMA', message: 'Item em espera.', type: 'system' });
                return;
            }
            // Atualiza o tempo de uso
            socket.itemCooldowns[dbItem.id] = now + dbItem.cooldown;
        }
        // -------------------------------------        

        if (dbItem.type === ITEM_TYPES.EQUIPMENT) {
            const slot = dbItem.slot;
            const currentEquippedId = socket.equipment[slot];
            socket.equipment[slot] = item.id;
            // CORREÇÃO DE SEGURANÇA:
            // Se por milagre tiver qtd > 1 (bug antigo), reduz 1. Se for 1, remove slot.
            if (item.qtd > 1) {
                item.qtd--; 
            } else {
                socket.inventory.splice(slotIndex, 1);
            }

            if (currentEquippedId) {
                // Ao desequipar, volta como um novo slot de qtd 1
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
        
        // Validação de distância
        const dx = socket.position.x - gItem.x;
        const dz = socket.position.z - gItem.z;
        if (dx*dx + dz*dz > 4.0) return; 

        const itemConfig = ITEM_DATABASE[gItem.itemId];
        const isEquip = itemConfig.type === ITEM_TYPES.EQUIPMENT;
        const existing = socket.inventory.find(i => i.id === gItem.itemId);

        // CORREÇÃO: Lógica de Equipamentos vs Consumíveis
        if (isEquip) {
            // Se for equipamento, adiciona UM POR UM em slots separados
            for(let i=0; i < gItem.qtd; i++) {
                socket.inventory.push({ id: gItem.itemId, qtd: 1 });
            }
        } else {
            // Se for poção/material, agrupa
            if (existing) {
                existing.qtd += gItem.qtd;
            } else {
                socket.inventory.push({ id: gItem.itemId, qtd: gItem.qtd });
            }
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
            
            const itemData = ITEM_DATABASE[id];
            if (itemData) {
                const isEquip = itemData.type === ITEM_TYPES.EQUIPMENT;
                
                if (isEquip) {
                    // Equipamentos: Cria N slots de 1
                    for(let i=0; i<qtd; i++) {
                        socket.inventory.push({ id: id, qtd: 1 });
                    }
                } else {
                    // Outros: Agrupa
                    const existing = socket.inventory.find(i => i.id === id);
                    if (existing) {
                        existing.qtd += qtd;
                    } else {
                        socket.inventory.push({ id: id, qtd: qtd });
                    }
                }
                
                sendInventoryUpdate(socket);
                socket.emit('chat_message', { username: 'SISTEMA', message: `Você recebeu: ${itemData.name} x${qtd}`, type: 'system' });
                return;
            }
        }
        if(onlinePlayers[socket.id]) io.to(socket.map).emit('chat_message', { username: socket.username, message: msg, id: socket.id });
    });

// --- SISTEMA DE SKILLS ---
    socket.on('use_skill', (data) => {
        const player = onlinePlayers[socket.id];
        if (!player || player.stats.hp <= 0) return;
        // Se o jogador já está castando algo e tenta usar outra skill (ou a mesma),
        // Interrompe o cast atual imediatamente.
        if (player.isCasting) {
            clearTimeout(player.castTimeout);
            player.isCasting = false;
            // Avisa o cliente que o cast anterior foi cancelado (para limpar barra de cast se houver)
            io.to(player.map).emit('cast_interrupted', player.id);
            // Opcional: Retornar aqui se quiser impedir "spam", mas permitir 
            // que a nova skill substitua a velha (mecânica de cancelamento) é mais fluido.
        }        

        const skill = SKILL_DATABASE[data.skillId];
        if (!skill) return;

        const mapData = MAP_CONFIG[player.map]; // Dados do mapa para checar PVP

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

        // 2. Resolução de Alvo
        let target = null;
        if (data.targetId) {
            if (monsters[data.targetId] && monsters[data.targetId].map === player.map && monsters[data.targetId].hp > 0) target = monsters[data.targetId];
            else if (onlinePlayers[data.targetId] && onlinePlayers[data.targetId].map === player.map) target = onlinePlayers[data.targetId];
        }

        // Auto-Target para skills ofensivas (exceto Área e Suporte)
        if (!target && skill.type !== 'SUPPORT' && skill.type !== 'AREA') {
            let bestDistSq = Infinity;
            const AUTO_AIM_RANGE = skill.type === 'MELEE' ? 3.0 : 12.0; 
            const AUTO_AIM_SQ = AUTO_AIM_RANGE * AUTO_AIM_RANGE;

            // Prioriza Monstros
            Object.values(monsters).forEach(m => {
                if (m.map !== player.map || m.hp <= 0) return;
                const dist = getDistance(m.position, player.position);
                if (dist * dist <= AUTO_AIM_SQ && dist < bestDistSq) {
                     if (skill.type === 'MELEE' || isTargetInFront(player, m)) {
                         target = m; bestDistSq = dist;
                     }
                }
            });
            
            // Se for mapa PVP e não achou monstro, procura Player
            if (!target && mapData.pvp) {
                 Object.values(onlinePlayers).forEach(p => {
                    if (p.map !== player.map || p.id === player.id || p.stats.hp <= 0) return;
                    const dist = getDistance(p.position, player.position);
                    if (dist * dist <= AUTO_AIM_SQ && dist < bestDistSq) {
                         if (skill.type === 'MELEE' || isTargetInFront(player, p)) {
                             target = p; bestDistSq = dist;
                         }
                    }
                });
            }
        }

        // Lógica de Suporte (Auto-Self)
        if (skill.type === 'SUPPORT') {
            if (!target) target = player;
            if (monsters[target.id]) target = player;
        }

        if (!target && skill.type !== 'AREA') {
             socket.emit('chat_message', { username: 'SISTEMA', message: 'Nenhum alvo encontrado.', type: 'system' });
             return;
        }

        // 3. Validações de Distância
        if (target && target.id !== player.id) {
            const dist = getDistance(player.position, target.position);
            if (dist > skill.range + 1.5) { 
                socket.emit('chat_message', { username: 'SISTEMA', message: 'Alvo fora de alcance.', type: 'system' });
                return;
            }
            if ((skill.type === 'CASTING' || (skill.type === 'INSTANT' && skill.range > 5)) && !isTargetInFront(player, target)) {
                socket.emit('chat_message', { username: 'SISTEMA', message: 'Precisa estar de frente.', type: 'system' });
                return;
            }
        }

        // --- EXECUÇÃO ---
        const executeSkill = () => {
            if (!onlinePlayers[socket.id] || onlinePlayers[socket.id].stats.hp <= 0) return;

            // Verifica PVP novamente antes de gastar Mana e CD (para alvos Player)
            let isMonster = target && !!monsters[target.id];
            if (target && !isMonster && target.id !== player.id && skill.type !== 'SUPPORT' && !mapData.pvp) {
                socket.emit('chat_message', { username: 'SISTEMA', message: 'PVP Proibido aqui.', type: 'system' });
                return;
            }

            player.stats.mp -= skill.manaCost;
            player.cooldowns[data.skillId] = Date.now() + skill.cooldown;

            // --- TIPO: CASTING (Bola de Fogo etc) ---
            if (skill.type === 'CASTING' && target) {
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
                 let realTargetId = target.id;

                 if (isMonster) {
                     finalHp = target.takeDamage(dmg, player.id);
                 } else {
                     let currentHp = Number(target.stats.hp);
                     target.stats.hp = Math.max(0, currentHp - dmg);
                     finalHp = target.stats.hp;
                 }

                io.to(player.map).emit('damage_dealt', {
                targetId: realTargetId, attackerId: player.id, damage: dmg, newHp: finalHp, isMonster: isMonster,
                x: parseFloat(target.position.x), z: parseFloat(target.position.z),
                dmgType: 'PROJECTILE' // <--- NOVO (Calcularemos pela distância)
                });
                 
                 let projType = skill.projectileType || 'ARROW'; 
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
                socket.broadcast.to(player.map).emit('player_update', { 
                    id: player.id, position: player.position, rotation: player.rotation, animation: 'ATTACK' 
                });
                
                let physDmg = skill.damage + Number(player.stats.atk || 10);
                let finalHp = 0;
                
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
                    x: parseFloat(target.position.x), z: parseFloat(target.position.z),
                    dmgType: 'MELEE' // <--- NOVO (Delay fixo de animação)
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
                if (skill.effect && skill.effect.hp) {
                    let healBase = Number(skill.effect.hp);
                    let bonusInt = Number(player.stats.int || 0) * 3;
                    let healAmount = healBase + bonusInt;
                    
                    let currentHp = Number(target.stats.hp);
                    let maxHp = Number(target.stats.maxHp);
                    let newHp = currentHp + healAmount;
                    if (newHp > maxHp) newHp = maxHp;
                    
                    target.stats.hp = newHp;
                    
                    io.to(player.map).emit('play_vfx', { targetId: target.id, type: 'POTION_HP' });

                    if (onlinePlayers[target.id]) {
                        sendStatsUpdate(target);
                        if (target.id !== player.id) {
                            target.emit('chat_message', { username: 'SISTEMA', message: `${player.username} curou você.`, type: 'system' });
                        }
                    }
                }
            }

            // --- TIPO: AREA (Meteoro) ---
            else if (skill.type === 'AREA') {
                if (data.x === undefined || data.z === undefined) return;
                const targetPos = { x: data.x, z: data.z };
                
                const distToCenter = getDistance(player.position, targetPos);
                if (distToCenter > skill.range + 2.0) {
                    socket.emit('chat_message', { username: 'SISTEMA', message: 'Área muito distante.', type: 'system' });
                    return;
                }

                socket.broadcast.to(player.map).emit('player_update', { 
                    id: player.id, position: player.position, rotation: player.rotation, animation: 'ATTACK' 
                });

                io.to(player.map).emit('play_vfx', { x: targetPos.x, z: targetPos.z, type: 'METEOR_EXPLOSION' });

                const radiusSq = skill.radius * skill.radius;
                const magicDmg = skill.damage + (player.stats.matk || 10);

                // 1. Monstros
                Object.values(monsters).forEach(m => {
                    if (m.map !== player.map || m.hp <= 0) return;
                    const distSq = (m.position.x - targetPos.x)**2 + (m.position.z - targetPos.z)**2;
                    if (distSq <= radiusSq) {
                        let finalHp = m.takeDamage(magicDmg, player.id);
                        io.to(player.map).emit('damage_dealt', {
                            targetId: m.id, attackerId: player.id, damage: magicDmg, newHp: finalHp, isMonster: true, 
                            x: m.position.x, z: m.position.z,
                            dmgType: 'AREA' // <--- NOVO (Delay da queda)
                        });
                        if (finalHp <= 0) handleMonsterDeath(player, m);
                    }
                });

                // 2. Players (PVP CHECK ROBUSTO)
                if (mapData.pvp) {
                    Object.values(onlinePlayers).forEach(p => {
                        if (p.map !== player.map || p.id === player.id || p.stats.hp <= 0) return;
                        const distSq = (p.position.x - targetPos.x)**2 + (p.position.z - targetPos.z)**2;
                        if (distSq <= radiusSq) {
                            let def = p.stats.def || 0;
                            let finalDmg = Math.max(1, magicDmg - (def * 0.5));
                            p.stats.hp = Math.max(0, p.stats.hp - finalDmg);
                            
                            io.to(player.map).emit('damage_dealt', {
                                targetId: p.id, attackerId: player.id, damage: Math.floor(finalDmg), newHp: p.stats.hp, isMonster: false, 
                                x: p.position.x, z: p.position.z,
                                dmgType: 'AREA' // <--- NOVO
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

    socket.on('update_hotbar', (newState) => {
        if (Array.isArray(newState) && newState.length === 6) {
            socket.hotbar = newState;
            // Opcional: Salvar imediatamente se quiser segurança total contra crash
            // savePlayerState(socket); 
        }
    });   
    
    // Sistema de Ping
    socket.on('ping_check', (startTime) => {
        socket.emit('pong_check', startTime);
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