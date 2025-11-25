// --- modules/GameConfig.js ---

// Tabela de XP (Nível 1 a 100)
const LEVEL_TABLE = [0]; 
for (let i = 1; i <= 100; i++) {
    LEVEL_TABLE[i] = Math.floor(100 * Math.pow(1.2, i - 1));
}

const BASE_ATTRIBUTES = {
    str: 5, agi: 5, int: 5, vit: 5
};

const RESPAWN_POINT = { map: 'vilarejo', x: 0, z: 0 };

const MAP_CONFIG = {
    'vilarejo': {
        id: 'vilarejo', asset: 'mapa1.glb', pvp: false, mapSize: 30,
        offset: { x: 0.5, y: 0, z: 0.5 },
        portals: [{ x: -2.10, z: 13.45, radius: 1.0, targetMap: 'floresta', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'rui', count: 2, area: { x: 0, z: 0, radius: 8 } }
        ] 
    },
    'floresta': {
        id: 'floresta', asset: 'mapa2.glb', pvp: true, mapSize: 20,
        offset: { x: 0, y: 0, z: 0 },
        portals: [{ x: 0, z: 8.5, radius: 1.0, targetMap: 'vilarejo', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'bat', count: 3, area: { x: 0, z: 0, radius: 8 } },
            { type: 'slime', count: 5, area: { x: -5, z: 5, radius: 6 } }
        ]
    }
};

const MONSTER_TYPES = {
    'slime': { hp: 80, model: 'monster1', speed: 0.05, range: 1.0, attackSpeed: 2000, dmg: 10, xp: 20 },
    'bat':   { hp: 150, model: 'monster2', speed: 0.08, range: 1.0, attackSpeed: 1500, dmg: 16, xp: 35 },
    'rui':   { hp: 1000, model: 'pve1', speed: 0.08, range: 1.0, attackSpeed: 1000, dmg: 80, xp: 50 },
};

module.exports = {
    LEVEL_TABLE,
    BASE_ATTRIBUTES,
    RESPAWN_POINT,
    MAP_CONFIG,
    MONSTER_TYPES
};