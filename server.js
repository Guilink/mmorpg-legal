// --- server.js ---

const { LEVEL_TABLE, BASE_ATTRIBUTES, RESPAWN_POINT, MAP_CONFIG, MONSTER_TYPES, ITEM_DATABASE, EQUIP_SLOTS, ITEM_TYPES } = require('./modules/GameConfig');

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

// --- FUNÇÕES DE RPG (Recalculate, XP) ---

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
    // Fórmulas atuais (você pode ajustar conforme seu game design)
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
        // NOVOS CAMPOS:
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
    
    Object.values(onlinePlayers).forEach(p => { 
        if(p.map === newMapId && p.id !== socket.id) mapPlayers[p.id] = getPublicPlayerData(p); 
    });
    Object.values(monsters).forEach(m => { 
        if(m.map === newMapId) mapMonsters[m.id] = m; 
    });

    socket.emit('map_changed', {
        mapConfig: MAP_CONFIG[newMapId],
        playerData: getPublicPlayerData(socket),
        mapPlayers: mapPlayers,
        mapMonsters: mapMonsters
    });

    socket.broadcast.to(newMapId).emit('player_joined', getPublicPlayerData(socket));
}

// --- GAME LOOP ---
setInterval(() => {
    const updates = {}; // MapID -> Array de Monstros
    const deadMonsters = [];

    // Loop dos Monstros (MANTENHA ISSO)
    Object.values(monsters).forEach(m => {
        if (m.hp > 0) { 
            m.update(100, onlinePlayers, {
                onAttack: (monster, target) => handleMonsterAttack(monster, target)
            });

            if(!updates[m.map]) updates[m.map] = [];
            
            // OTIMIZAÇÃO DE BANDA: Arredondar posições para 3 casas decimais
            // Isso reduz drasticamente o tamanho do pacote JSON enviado
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

    // Loop de Monstros Mortos (MANTENHA ISSO)
    deadMonsters.forEach(id => {
        const m = monsters[id];
        if(m) { delete monsters[id]; io.to(m.map).emit('monster_dead', id); }
    });

    // Envio dos Pacotes (MANTENHA ISSO)
    Object.keys(updates).forEach(mapId => {
        io.to(mapId).emit('monsters_update', updates[mapId]);
    });
    
    // Respawn (MANTENHA ISSO)
    if(Math.random() < 0.05) spawnInitialMonsters();

}, 100);

// --- SOCKET CONNECTION Envio de Status do Servidor (A cada 2s) ---
setInterval(() => {
    const total = Object.keys(onlinePlayers).length;
    io.emit('server_stats', { total });
}, 2000);

io.on('connection', (socket) => {
    
    socket.on('register', (data) => {
        if (accounts[data.username]) socket.emit('login_error', 'Usuário já existe.');
        else {
            accounts[data.username] = { 
                password: data.password, 
                data: { 
                    map: 'vilarejo', position: { x: 0, y: 0, z: 0 }, 
                    stats: { hp: 100, mp: 50, cash: 0 },
                    inventory: [], // Array de objetos { id: 1, qtd: 5 }
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

            const myData = getPublicPlayerData(socket);
            myData.level = socket.level;
            myData.xp = socket.xp;
            myData.nextLevelXp = socket.nextLevelXp;
            myData.points = socket.pointsToDistribute;
            myData.attributes = socket.attributes;

            socket.emit('login_success', {
                playerId: socket.id, playerData: myData, mapConfig: MAP_CONFIG[socket.map],
                mapPlayers: mapPlayers, mapMonsters: mapMonsters, monsterTypes: MONSTER_TYPES, itemDB: ITEM_DATABASE,
                inventory: socket.inventory, equipment: socket.equipment
            });
            
            socket.broadcast.to(socket.map).emit('player_joined', getPublicPlayerData(socket));
        } else {
            socket.emit('login_error', 'Dados incorretos.');
        }
    });

    socket.on('player_update', (data) => {
        // Verifica se o player existe
        if (!onlinePlayers[socket.id]) return;

        // --- LINHA QUE ESTAVA FALTANDO ---
        const mapConfig = MAP_CONFIG[socket.map];
        // ---------------------------------
        
        // Segurança: Se por acaso o mapa não existir na config, para tudo
        if (!mapConfig) return;

        // Verificação de Limites (Anti-noclip básico)
        const limit = mapConfig.mapSize / 2;
        if (Math.abs(data.position.x) > limit || Math.abs(data.position.z) > limit) return;

        // Atualiza estado no servidor
        socket.position = data.position;
        socket.rotation = data.rotation;
        socket.animation = data.animation;
        
        // Envia para os outros (COM O USERNAME PARA CORRIGIR O BUG VISUAL)
        socket.broadcast.to(socket.map).emit('player_moved', { 
            id: socket.id, 
            username: socket.username, 
            position: data.position, 
            rotation: data.rotation, 
            animation: data.animation 
        });

        // Checagem de Portais (A linha que estava dando erro era aqui dentro ok)
        if (mapConfig.portals) {
            mapConfig.portals.forEach(portal => {
                const dx = socket.position.x - portal.x;
                const dz = socket.position.z - portal.z;
                // Se pisou no portal, troca de mapa
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
        const RANGE_SQ = ATTACK_RANGE * ATTACK_RANGE; // Pre-calcula ao quadrado
        
        let bestTarget = null;
        let minDistSq = Infinity; // Muda para Distância ao Quadrado
        let isMonsterTarget = false;

        // Verifica Monstros
        Object.values(monsters).forEach(m => {
            if (m.map !== attacker.map || m.hp <= 0) return;
            const dx = m.position.x - attacker.position.x;
            const dz = m.position.z - attacker.position.z;
            const distSq = (dx*dx) + (dz*dz);
            
            if (distSq <= RANGE_SQ && distSq < minDistSq) {
                bestTarget = m; minDistSq = distSq; isMonsterTarget = true;
            }
        });

        // Verifica Players (PVP)
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

    // 1. USAR ITEM (Consumível ou Equipar via clique)
    socket.on('use_item', (slotIndex) => {
        if (!socket.inventory[slotIndex]) return;
        
        const item = socket.inventory[slotIndex];
        const dbItem = ITEM_DATABASE[item.id];
        
        if (!dbItem) return;

        // Se for EQUIPAMENTO, tenta equipar
        if (dbItem.type === ITEM_TYPES.EQUIPMENT) {
            const slot = dbItem.slot; // weapon, armor, etc
            
            // Verifica se já tem algo no slot
            const currentEquippedId = socket.equipment[slot];
            
            // 1. Equipa o novo
            socket.equipment[slot] = item.id;
            
            // 2. Remove o novo da mochila
            socket.inventory.splice(slotIndex, 1);
            
            // 3. Se tinha algo velho equipado, devolve pra mochila
            if (currentEquippedId) {
                socket.inventory.push({ id: currentEquippedId, qtd: 1 });
            }
            
            sendInventoryUpdate(socket);
        }
        
        // Se for CONSUMÍVEL (Poção)
        else if (dbItem.type === ITEM_TYPES.CONSUMABLE) {
            // Aplica efeitos
            if (dbItem.effect.hp) socket.stats.hp = Math.min(socket.stats.maxHp, socket.stats.hp + dbItem.effect.hp);
            if (dbItem.effect.mp) socket.stats.mp = Math.min(socket.stats.maxMp, socket.stats.mp + dbItem.effect.mp);
            
            // Remove 1 unidade
            item.qtd--;
            if (item.qtd <= 0) {
                socket.inventory.splice(slotIndex, 1);
            }
            
            sendInventoryUpdate(socket);
        }
    });

    // 2. DESEQUIPAR
    socket.on('unequip_item', (slotName) => {
        const itemId = socket.equipment[slotName];
        if (!itemId) return;

        // Tira do slot
        socket.equipment[slotName] = null;
        
        // Põe na mochila
        socket.inventory.push({ id: itemId, qtd: 1 });
        
        sendInventoryUpdate(socket);
    });    

    socket.on('chat_message', (msg) => {
        // Adicione esta verificação de comando:
        if (msg.startsWith('/give ')) {
            const parts = msg.split(' ');
            const id = parseInt(parts[1]);
            const qtd = parseInt(parts[2]) || 1;
            
            if (ITEM_DATABASE[id]) {
                // Verifica se já tem o item para empilhar (se não for equip)
                const existing = socket.inventory.find(i => i.id === id);
                const isEquip = ITEM_DATABASE[id].type === ITEM_TYPES.EQUIPMENT;
                
                if (existing && !isEquip) {
                    existing.qtd += qtd;
                } else {
                    socket.inventory.push({ id: id, qtd: qtd });
                }
                
                sendInventoryUpdate(socket);
                socket.emit('chat_message', { username: 'SISTEMA', message: `Você recebeu: ${ITEM_DATABASE[id].name}`, type: 'system' });
                return; // Não manda pro chat global
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