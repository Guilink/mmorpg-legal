// --- server.js ---

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

// --- IMPORTAÇÕES NOVAS ---
const { LEVEL_TABLE, BASE_ATTRIBUTES, RESPAWN_POINT, MAP_CONFIG, MONSTER_TYPES } = require('./modules/GameConfig');
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
    const attrs = socket.attributes || { ...BASE_ATTRIBUTES };
    
    const maxHp = 100 + (attrs.vit * 10);
    const def = Math.floor(attrs.vit * 1);
    
    const maxMp = 50 + (attrs.int * 10);
    const matk = Math.floor(attrs.int * 2);
    
    const atk = 10 + (attrs.str * 2);
    const eva = Math.floor((attrs.str * 0.1) + (attrs.agi * 0.5));
    
    const attackSpeed = Math.max(500, 2000 - (attrs.agi * 20)); 
    
    socket.stats = {
        ...socket.stats,
        maxHp, maxMp, atk, matk, def, eva, attackSpeed
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
        io.to(socket.map).emit('chat_message', { 
            username: 'SISTEMA', message: `${socket.username} subiu para o nível ${socket.level}!`, type: 'system' 
        });
        socket.emit('level_up_event', { level: socket.level });
    }
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
        map: socket.map, position: socket.position, stats: socket.stats,
        level: socket.level, xp: socket.xp, points: socket.pointsToDistribute, attributes: socket.attributes
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

            if(!updates[m.map]) updates[m.map] = []; // Cria como Array []
            updates[m.map].push({ 
                id: m.id, type: m.type, position: m.position, 
                rotation: m.rotation, animation: m.animation, hp: m.hp 
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

    // *** SE VOCÊ ADICIONOU O BLOCO "ATUALIZAÇÃO DOS PLAYERS" AQUI, APAGUE-O ***
    // Não precisamos dele. O evento 'player_moved' já é disparado
    // quando o cliente envia 'player_update' lá embaixo no código.

}, 100);

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    
    socket.on('register', (data) => {
        if (accounts[data.username]) socket.emit('login_error', 'Usuário já existe.');
        else {
            accounts[data.username] = { 
                password: data.password, 
                data: { 
                    map: 'vilarejo', position: { x: 0, y: 0, z: 0 }, 
                    stats: { hp: 100, mp: 50, cash: 0 },
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
                mapPlayers: mapPlayers, mapMonsters: mapMonsters
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
        
        let bestTarget = null;
        let minDist = Infinity;
        let isMonsterTarget = false;

        Object.values(monsters).forEach(m => {
            if (m.map !== attacker.map || m.hp <= 0) return;
            const dist = Math.hypot(m.position.x - attacker.position.x, m.position.z - attacker.position.z);
            if (dist <= ATTACK_RANGE && dist < minDist) {
                bestTarget = m; minDist = dist; isMonsterTarget = true;
            }
        });

        if (!bestTarget && MAP_CONFIG[attacker.map].pvp) {
            Object.values(onlinePlayers).forEach(target => {
                if (target.id === attacker.id || target.map !== attacker.map) return;
                const dist = Math.hypot(target.position.x - attacker.position.x, target.position.z - attacker.position.z);
                if (dist <= ATTACK_RANGE && dist < minDist) {
                    bestTarget = target; minDist = dist; isMonsterTarget = false;
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

    socket.on('chat_message', (msg) => {
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