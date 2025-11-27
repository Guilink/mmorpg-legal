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

// --- TIPOS DE ITENS ---
const ITEM_TYPES = {
    CONSUMABLE: 'consumable', // Poções, Comidas
    EQUIPMENT: 'equipment',   // Armas, Armaduras
    MATERIAL: 'material'      // Drops, Quest items
};

const EQUIP_SLOTS = {
    WEAPON: 'weapon',
    ARMOR: 'armor',
    HEAD: 'head',
    LEGS: 'legs', // Botas
    ACCESSORY: 'accessory'
};

// --- BANCO DE DADOS DE ITENS ---
// A chave é o ID do item.
const ITEM_DATABASE = {
    // --- CONSUMÍVEIS (ID 1-99) ---
    1: { 
        id: 1, name: "Poção de Vida P", type: ITEM_TYPES.CONSUMABLE, 
        icon: "pot_hp_s.png", description: "Recupera 50 HP",
        effect: { hp: 50 } 
    },
    2: { 
        id: 2, name: "Poção de Mana P", type: ITEM_TYPES.CONSUMABLE, 
        icon: "pot_mp_s.png", description: "Recupera 30 MP",
        effect: { mp: 30 } 
    },

    // --- EQUIPAMENTOS (ID 100-299) ---
    100: { 
        id: 100, name: "Espada de Madeira", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        icon: "sword_wood.png", description: "Uma espada simples de treino.",
        stats: { atk: 5 } // Dá +5 de Ataque direto
    },
    101: { 
        id: 101, name: "Espada de Ferro", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        icon: "sword_iron.png", description: "Lâmina afiada e pesada.",
        stats: { atk: 15, str: 2 } // Dá +15 ATK e +2 de Força
    },
    200: {
        id: 200, name: "Túnica de Linho", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.ARMOR,
        icon: "armor_cloth.png", description: "Proteção básica.",
        stats: { def: 3, hp: 20 } // Dá +3 DEF e +20 HP Máximo
    },
    
    // --- MATERIAIS / DROPS (ID 300+) ---
    300: { 
        id: 300, name: "Gosma Verde", type: ITEM_TYPES.MATERIAL, 
        icon: "slime_goo.png", description: "Restos de um Slime.",
        price: 5 // Valor de venda no NPC
    }
};

const MAP_CONFIG = {
    'vilarejo': {
        id: 'vilarejo', asset: 'mapa1.glb', pvp: false, mapSize: 30,
        offset: { x: 0.5, y: 0, z: 0.5 },
        portals: [{ x: -2.10, z: 13.45, radius: 1.0, targetMap: 'floresta', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'bolota', count: 3, area: { x: 0, z: 0, radius: 8 } },
            { type: 'morcego', count: 3, area: { x: 0, z: 0, radius: 8 } },
        ] 
    },
    'floresta': {
        id: 'floresta', asset: 'mapa2.glb', pvp: true, mapSize: 20,
        offset: { x: 0, y: 0, z: 0 },
        portals: [{ x: 0, z: 8.5, radius: 1.0, targetMap: 'vilarejo', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'verdinho', count: 3, area: { x: 0, z: 0, radius: 8 } },
            { type: 'cogumelo', count: 3, area: { x: -5, z: 5, radius: 6 } },
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
        speed: 0.10,
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
    MONSTER_TYPES,
    ITEM_DATABASE,
    ITEM_TYPES,
    EQUIP_SLOTS
};