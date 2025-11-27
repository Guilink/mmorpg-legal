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
            { type: 'bolota', count: 4, area: { x: 0, z: 0, radius: 8 } },
            { type: 'morcego', count: 4, area: { x: 0, z: 0, radius: 8 } },
        ] 
    },
    'floresta': {
        id: 'floresta', asset: 'mapa2.glb', pvp: true, mapSize: 20,
        offset: { x: 0, y: 0, z: 0 },
        portals: [{ x: 0, z: 8.5, radius: 1.0, targetMap: 'vilarejo', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'verdinho', count: 4, area: { x: 0, z: 0, radius: 8 } },
            { type: 'cogumelo', count: 4, area: { x: -5, z: 5, radius: 6 } },
            { type: 'cogumelochefe', count: 1, area: { x: -5, z: 5, radius: 6 } }
        ]
    }
};

const BEHAVIOR = {
    NEUTRAL: 0,
    AGGRESSIVE: 1
};

const MONSTER_TYPES = {
    'bolota': { 
        name: 'Bolota Cascavél',
        model: 'm1_slimecobra', 
        scale: 0.40,
        hp: 80, maxHp: 80,
        speed: 0.06,
        range: 1.0,
        attackSpeed: 1800,
        dmg: 8,
        xp: 15,
        behavior: BEHAVIOR.NEUTRAL, // Passivo
        sightRange: 10.0        
    },

    'morcego': { 
        name: 'Morcego',
        model: 'm2_morcego', 
        scale: 0.30,
        hp: 130, maxHp: 130,
        speed: 0.12,
        range: 1.0,
        attackSpeed: 1500,
        dmg: 14,
        xp: 30,
        behavior: BEHAVIOR.AGGRESSIVE, // Passivo
        sightRange: 8.0          
    },

    'verdinho': { 
        name: 'Verdinho',
        model: 'm3_slimeverde', 
        scale: 0.05,
        hp: 300, maxHp: 300,
        speed: 0.10,
        range: 1.0,
        attackSpeed: 1200,
        dmg: 22,
        xp: 50,
        behavior: BEHAVIOR.NEUTRAL, // Passivo
        sightRange: 10.0          
    },

    'cogumelo': {
        name: 'Cogulouco',
        model: 'm4_cogumelo',
        scale: 0.05,
        hp: 900, maxHp: 900,
        speed: 0.06,
        range: 1.0,
        attackSpeed: 2000,
        dmg: 35,
        xp: 120,
        behavior: BEHAVIOR.NEUTRAL, // Passivo
        sightRange: 10.0          
    },

    'cogumelochefe': {
        name: 'Mestre Cogulouco',
        model: 'm4_cogumelo',
        scale: 0.07,
        hp: 2000, maxHp: 2000,
        speed: 0.10,
        range: 1.3,
        attackSpeed: 1800,
        dmg: 60,
        xp: 300,
        behavior: BEHAVIOR.AGGRESSIVE, // Passivo
        sightRange: 10.0         
    }
};

module.exports = {
    LEVEL_TABLE,
    BASE_ATTRIBUTES,
    RESPAWN_POINT,
    MAP_CONFIG,
    MONSTER_TYPES
};