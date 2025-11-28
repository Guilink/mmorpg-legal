// --- server.js ---

const { 
    LEVEL_TABLE, 
    BASE_ATTRIBUTES, 
    RESPAWN_POINT, 
    MAP_CONFIG, 
    MONSTER_TYPES, 
    ITEM_DATABASE, 
    EQUIP_SLOTS, 
    ITEM_TYPES 
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
const groundItems = {}; // Armazena todos os itens caídos no mundo
let groundItemCounter = 0; // Contador para gerar IDs únicos (item_1, item_2...)

function spawnGroundItem(itemId, qtd, map, x, z) {
    groundItemCounter++;
    const uniqueId = `item_${groundItemCounter}`;
    
    // Pequena variação aleatória na posição para itens não caírem um em cima do outro exato
    const rX = x + (Math.random() * 0.5 - 0.25);
    const rZ = z + (Math.random() * 0.5 - 0.25);

    groundItems[uniqueId] = {
        uniqueId: uniqueId,
        itemId: itemId,
        qtd: qtd,
        map: map,
        x: rX,
        z: rZ,
        expiresAt: Date.now() + 40000 // Expira em 40 segundos
    };

    // Avisa todos os jogadores do mapa que o item caiu
    io.to(map).emit('ground_item_spawn', groundItems[uniqueId]);
}

// --- FUNÇÕES DE RPG (Recalculate, XP, Inventário) ---

function recalculateStats(socket) {
    // 1. Começa com os atributos base do personagem (distribuídos por pontos)
    let totalStr = socket.attributes.str;
    let totalAgi = socket.attributes.agi;
    let totalInt = socket.attributes.int;
    let totalVit = socket.attributes.vit;

    // Variáveis para bônus diretos de equipamentos (ex: Espada que dá +10 ATK direto)
    let bonusHp = 0, bonusMp = 0, bonusAtk = 0, bonusMatk = 0, bonusDef = 0, bonusEva = 0;

    // 2. Percorre os equipamentos equipados
    if (socket.equipment) {
        Object.values(socket.equipment).forEach(itemId => {
            if (!itemId) return; // Slot vazio

            const itemData = ITEM_DATABASE[itemId];
            if (!itemData || !itemData.stats) return; // Item inválido ou sem stats

            const s = itemData.stats;

            // Soma Atributos Primários (que escalam)
            if(s.str) totalStr += s.str;
            if(s.agi) totalAgi += s.agi;
            if(s.int) totalInt += s.int;
            if(s.vit) totalVit += s.vit;

            // Soma Status Secundários (valores fixos)
            if(s.hp) bonusHp += s.hp;
            if(s.mp) bonusMp += s.mp;
            if(s.atk) bonusAtk += s.atk;
            if(s.matk) bonusMatk += s.matk;
            if(s.def) bonusDef += s.def;
            if(s.eva) bonusEva += s.eva;
        });
    }

    // 3. Calcula os status derivados usando os TOTAIS (Base + Itens)
    const maxHp = 100 + (totalVit * 10) + bonusHp;
    const maxMp = 50 + (totalInt * 10) + bonusMp;
    
    const def = Math.floor(totalVit * 1) + bonusDef;
    const matk = Math.floor(totalInt * 2) + bonusMatk;
    
    const atk = 10 + (totalStr * 2) + bonusAtk;
    const eva = Math.floor((totalStr * 0.1) + (totalAgi * 0.5)) + bonusEva;
    
    const attackSpeed = Math.max(500, 2000 - (totalAgi * 20)); 

    // 4. Salva no socket
    socket.stats = {
        ...socket.stats,
        maxHp, maxMp, atk, matk, def, eva, attackSpeed,
        // Guardamos os totais para exibir na UI "C" depois (Força: 50 + 5)
        totalAttributes: { str: totalStr, agi: totalAgi, int: totalInt, vit: totalVit }
    };
    
    // Cura se o HP atual for maior que o novo máximo (ex: trocou equip que dava HP)
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
        io.to(socket.map).emit('chat_message', { 
            username: 'SISTEMA', message: `${socket.username} subiu para o nível ${socket.level}!`, type: 'system' 
        });
        socket.emit('level_up_event', { level: socket.level });
    }
    sendStatsUpdate(socket);
}

function sendInventoryUpdate(socket) {
    socket.emit('inventory_update', {
        inventory: socket.inventory,
        equipment: socket.equipment
    });
    // Como equipar muda status (HP/ATK), mandamos update de stats junto
    recalculateStats(socket); 
    sendStatsUpdate(socket);
}

function sendStatsUpdate(socket) {
    socket.emit('update_stats', {
        stats: socket.stats,
        level: socket.level,
        xp: socket.xp,
        nextLevelXp: socket.nextLevelXp,
        attributes: socket.attributes,
        points: socket.pointsToDistribute
    });
}

// --- LÓGICA DE JOGO ---

function handleMonsterAttack(monster, player) {
    monster.startAttack(); // Inicia animação e cooldown no objeto monstro
    
    const defense = player.stats.def || 0;
    const rawDmg = monster.config.dmg;
    const finalDmg = Math.max(1, rawDmg - (defense * 0.5)); 

    player.stats.hp = Math.max(0, player.stats.hp - finalDmg);
    
    // Notifica visual
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

function handlePlayerDeath(player) {
    player.stats.hp = player.stats.maxHp;
    player.stats.mp = player.stats.maxMp;
    player.animation = 'IDLE';
    Object.values(monsters).forEach(m => { if(m.targetId === player.id) m.targetId = null; });

    io.to(player.map).emit('chat_message', { username: 'SISTEMA', message: `${player.username} desmaiou!`, type: 'system' });
    sendStatsUpdate(player); // Atualiza HP cheio no cliente

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
        map: socket.map, 
        position: socket.position, 
        stats: socket.stats,
        level: socket.level, 
        xp: socket.xp, 
        points: socket.pointsToDistribute, 
        attributes: socket.attributes,
        inventory: socket.inventory,
        equipment: socket.equipment
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
    
    // Filtra Entidades do Mapa Novo
    Object.values(onlinePlayers).forEach(p => { 
        if(p.map === newMapId && p.id !== socket.id) mapPlayers[p.id] = getPublicPlayerData(p); 
    });
    Object.values(monsters).forEach(m => { 
        if(m.map === newMapId) mapMonsters[m.id] = m; 
    });
    // Filtra Itens no Chão
    Object.values(groundItems).forEach(i => { 
        if(i.map === newMapId) mapGroundItems[i.uniqueId] = i; 
    });

    socket.emit('map_changed', {
        mapConfig: MAP_CONFIG[newMapId],
        playerData: getPublicPlayerData(socket),
        mapPlayers: mapPlayers,
        mapMonsters: mapMonsters,
        mapGroundItems: mapGroundItems // <--- ENVIA ITENS NO CHÃO
    });

    socket.broadcast.to(newMapId).emit('player_joined', getPublicPlayerData(socket));
}

// --- GAME LOOP ---
setInterval(() => {
    const now = Date.now();
    const updates = {}; // MapID -> Array de Monstros
    const deadMonsters = [];

    // Loop dos Monstros
    Object.values(monsters).forEach(m => {
        if (m.hp > 0) { 
            m.update(100, onlinePlayers, {
                onAttack: (monster, target) => handleMonsterAttack(monster, target)
            });

            if(!updates[m.map]) updates[m.map] = [];
            
            // OTIMIZAÇÃO: Arredondar posições
            updates[m.map].push({ 
                id: m.id, 
                type: m.type, 
                position: { 
                    x: parseFloat(m.position.x.toFixed(3)), 
                    y: 0, 
                    z: parseFloat(m.position.z.toFixed(3)) 
                }, 
                rotation: parseFloat(m.rotation.toFixed(3)), 
                animation: m.animation, 
                hp: m.hp 
            });
        } else {
            deadMonsters.push(m.id);
        }
    });

    // Loop de Monstros Mortos
    deadMonsters.forEach(id => {
        const m = monsters[id];
        if(m) { delete monsters[id]; io.to(m.map).emit('monster_dead', id); }
    });

    // Envio dos Pacotes
    Object.keys(updates).forEach(mapId => {
        io.to(mapId).emit('monsters_update', updates[mapId]);
    });
    
    // Respawn
    if(Math.random() < 0.05) spawnInitialMonsters();

// --- LIMPEZA DE ITENS EXPIRADOS ---
    Object.values(groundItems).forEach(item => {
        if (now > item.expiresAt) {
            delete groundItems[item.uniqueId];
            
            // MUDANÇA: Em vez de 'ground_item_remove', emitimos 'ground_item_expire'
            io.to(item.map).emit('ground_item_expire', item.uniqueId); 
        }
    });

}, 100);

// --- STATUS DO SERVIDOR ---
setInterval(() => {
    const total = Object.keys(onlinePlayers).length;
    io.emit('server_stats', { total });
}, 2000);

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

            recalculateStats(socket);
            
            onlinePlayers[socket.id] = socket;
            socket.join(socket.map);

            const mapPlayers = {};
            Object.values(onlinePlayers).forEach(p => { 
                if(p.map === socket.map && p.id !== socket.id) mapPlayers[p.id] = getPublicPlayerData(p); 
            });
            const mapMonsters = {};
            Object.values(monsters).forEach(m => { 
                if(m.map === socket.map) mapMonsters[m.id] = m; 
            });
            // Filtra Itens no Chão
            const mapGroundItems = {};
            Object.values(groundItems).forEach(i => { 
                if(i.map === socket.map) mapGroundItems[i.uniqueId] = i; 
            });

            const myData = getPublicPlayerData(socket);
            myData.level = socket.level;
            myData.xp = socket.xp;
            myData.nextLevelXp = socket.nextLevelXp;
            myData.points = socket.pointsToDistribute;
            myData.attributes = socket.attributes;

            socket.emit('login_success', {
                playerId: socket.id, playerData: myData, mapConfig: MAP_CONFIG[socket.map],
                mapPlayers: mapPlayers, mapMonsters: mapMonsters, mapGroundItems: mapGroundItems,
                monsterTypes: MONSTER_TYPES, itemDB: ITEM_DATABASE,
                inventory: socket.inventory, equipment: socket.equipment
            });
            
            socket.broadcast.to(socket.map).emit('player_joined', getPublicPlayerData(socket));
        } else {
            socket.emit('login_error', 'Dados incorretos.');
        }
    });

    socket.on('player_update', (data) => {
        if (!onlinePlayers[socket.id]) return;
        const mapConfig = MAP_CONFIG[socket.map];
        if (!mapConfig) return;

        const limit = mapConfig.mapSize / 2;
        if (Math.abs(data.position.x) > limit || Math.abs(data.position.z) > limit) return;

        socket.position = data.position;
        socket.rotation = data.rotation;
        socket.animation = data.animation;
        
        socket.broadcast.to(socket.map).emit('player_moved', { 
            id: socket.id, 
            username: socket.username, 
            position: data.position, 
            rotation: data.rotation, 
            animation: data.animation 
        });

        if (mapConfig.portals) {
            mapConfig.portals.forEach(portal => {
                const dx = socket.position.x - portal.x;
                const dz = socket.position.z - portal.z;
                if (Math.sqrt(dx*dx + dz*dz) < portal.radius) {
                    switchMap(socket, portal.targetMap, portal.targetX, portal.targetZ);
                }
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

    socket.on('attack_request', () => {
        if (!onlinePlayers[socket.id]) return;
        const attacker = onlinePlayers[socket.id];
        const ATTACK_RANGE = 1.5; 
        const RANGE_SQ = ATTACK_RANGE * ATTACK_RANGE;
        
        let bestTarget = null;
        let minDistSq = Infinity;
        let isMonsterTarget = false;

        // Monstros
        Object.values(monsters).forEach(m => {
            if (m.map !== attacker.map || m.hp <= 0) return;
            const dx = m.position.x - attacker.position.x;
            const dz = m.position.z - attacker.position.z;
            const distSq = (dx*dx) + (dz*dz);
            if (distSq <= RANGE_SQ && distSq < minDistSq) {
                bestTarget = m; minDistSq = distSq; isMonsterTarget = true;
            }
        });

        // Players (PVP)
        if (!bestTarget && MAP_CONFIG[attacker.map].pvp) {
            Object.values(onlinePlayers).forEach(target => {
                if (target.id === attacker.id || target.map !== attacker.map) return;
                const dx = target.position.x - attacker.position.x;
                const dz = target.position.z - attacker.position.z;
                const distSq = (dx*dx) + (dz*dz);
                if (distSq <= RANGE_SQ && distSq < minDistSq) {
                    bestTarget = target; minDistSq = distSq; isMonsterTarget = false;
                }
            });
        }

        if (bestTarget) {
            const baseDmg = attacker.stats.atk || 10;
            const variation = (Math.random() * 0.2) + 0.9; 
            const dmg = Math.floor(baseDmg * variation);
            
            let currentHp = 0;
            let targetId = bestTarget.id;

            if (isMonsterTarget) {
                currentHp = bestTarget.takeDamage(dmg, attacker.id);
                if (currentHp <= 0) {
                    const type = bestTarget.type;
                    const mapId = bestTarget.map;
                    const mobConfig = MONSTER_TYPES[type];
                    
                    // --- SISTEMA DE DROP (NOVO) ---
                    if (mobConfig.drops) {
                        mobConfig.drops.forEach(drop => {
                            const roll = Math.random() * 100;
                            if (roll <= drop.chance) {
                                spawnGroundItem(drop.itemId, 1, mapId, bestTarget.position.x, bestTarget.position.z);
                            }
                        });
                    }
                    // -----------------------------

                    delete monsters[targetId];
                    io.to(attacker.map).emit('monster_dead', targetId);
                    
                    attacker.stats.cash += 10;
                    gainExperience(attacker, mobConfig.xp || 20);
                    scheduleMonsterRespawn(type, mapId);
                }
            } else {
                const targetDef = bestTarget.stats.def || 0;
                const pvpDmg = Math.max(1, dmg - (targetDef * 0.5));
                bestTarget.stats.hp = Math.max(0, bestTarget.stats.hp - pvpDmg);
                currentHp = bestTarget.stats.hp;
                
                if (currentHp <= 0) handlePlayerDeath(bestTarget);
                else sendStatsUpdate(bestTarget); 
            }

            io.to(attacker.map).emit('damage_dealt', {
                targetId: targetId, attackerId: attacker.id, damage: Math.floor(dmg), newHp: currentHp, isMonster: isMonsterTarget
            });
        }
    });

    // --- SISTEMA DE INVENTÁRIO & DROPS ---

    // 1. USAR ITEM
    socket.on('use_item', (slotIndex) => {
        if (!socket.inventory[slotIndex]) return;
        
        const item = socket.inventory[slotIndex];
        const dbItem = ITEM_DATABASE[item.id];
        if (!dbItem) return;

        if (dbItem.type === ITEM_TYPES.EQUIPMENT) {
            // ... (código de equipar existente, mantenha igual) ...
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
            // --- MODIFICAÇÃO PARA EFEITOS VISUAIS ---
            let vfxType = null;

            if (dbItem.effect.hp) {
                socket.stats.hp = Math.min(socket.stats.maxHp, socket.stats.hp + dbItem.effect.hp);
                vfxType = 'POTION_HP'; // Identificador do efeito
            }
            if (dbItem.effect.mp) {
                socket.stats.mp = Math.min(socket.stats.maxMp, socket.stats.mp + dbItem.effect.mp);
                vfxType = 'POTION_MP';
            }
            
            item.qtd--;
            if (item.qtd <= 0) socket.inventory.splice(slotIndex, 1);
            sendInventoryUpdate(socket);

            // AVISA TODOS NO MAPA SOBRE O EFEITO
            if (vfxType) {
                io.to(socket.map).emit('play_vfx', {
                    targetId: socket.id,
                    type: vfxType
                });
            }
            // ----------------------------------------
        }
    });

    // 2. DESEQUIPAR
    socket.on('unequip_item', (slotName) => {
        const itemId = socket.equipment[slotName];
        if (!itemId) return;
        socket.equipment[slotName] = null;
        socket.inventory.push({ id: itemId, qtd: 1 });
        sendInventoryUpdate(socket);
    });    

    // 3. JOGAR NO CHÃO (DROP DO JOGADOR)
    socket.on('drop_item_request', (data) => {
        if (!socket.inventory[data.slotIndex]) return;
        const item = socket.inventory[data.slotIndex];
        
        if (data.qtd <= 0 || data.qtd > item.qtd) return;

        spawnGroundItem(item.id, data.qtd, socket.map, socket.position.x, socket.position.z);

        item.qtd -= data.qtd;
        if (item.qtd <= 0) {
            socket.inventory.splice(data.slotIndex, 1);
        }
        sendInventoryUpdate(socket);
    });

    // 4. PEGAR DO CHÃO (PICKUP)
    socket.on('pickup_request', (uniqueId) => {
        const gItem = groundItems[uniqueId];
        
        // Valida se existe e mapa
        if (!gItem || gItem.map !== socket.map) return;
        
        // Valida distância
        const dx = socket.position.x - gItem.x;
        const dz = socket.position.z - gItem.z;
        if (dx*dx + dz*dz > 2.0) return; // Raio 2m

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