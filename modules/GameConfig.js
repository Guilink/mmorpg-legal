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
    CONSUMABLE: 'consumable',
    EQUIPMENT: 'equipment',
    MATERIAL: 'material'
};

const EQUIP_SLOTS = {
    WEAPON: 'weapon',
    ARMOR: 'armor',
    HEAD: 'head',
    LEGS: 'legs',
    ACCESSORY: 'accessory'
};

const WEAPON_TYPES = {
    MELEE: 'melee',
    RANGED: 'ranged'
};

const SKILL_DATABASE = {
    'fireball': {
        id: 'fireball', name: "Bola de Fogo", type: 'CASTING',
        castTime: 1000, cooldown: 3000, range: 15, manaCost: 10,
        damage: 40, animation: 'ATTACK',
        icon: 'skill_fireball.png',
        projectileType: 'FIREBALL',
        description: "Clássica, quente e irresponsavelmente explosiva. Jogue no inimigo, não em você por favor.",
        soundCast: 'cast_ranged', // Som do disparo (casting_skill.mp3)
        soundHit: 'hit_magic'          
    },
    'strong_slash': {
        id: 'strong_slash', name: "Golpe Feroz", type: 'MELEE',
        castTime: 0, cooldown: 5000, range: 1.3, manaCost: 5,
        damage: 30, animation: 'ATTACK',
        icon: 'skill_slash.png',
        description: "Um corte tão forte que até sua arma pensa duas vezes. Ideal para convencer inimigos a repensar escolhas.",
        soundCast: null,          // Ataque físico geralmente não tem som de "cast", só o hit
        soundHit: 'hit_skill'     // Som do impacto da skill (melee_skill.mp3)
    },
    'heal': {
        id: 'heal', name: "Cura Rápida", type: 'SUPPORT',
        castTime: 1000, cooldown: 4000, range: 10, manaCost: 15,
        effect: { hp: 50 }, animation: 'IDLE',
        icon: 'skill_heal.png',
        description: "Um encantamento gentil que remenda ferimentos e dignidade, na medida do possível.",
        soundCast: 'cast_support', // Som do cast (support_skill.mp3)
        soundHit: null              // A cura não tem impacto visual, então não há som de hit
    },
    'meteor': {
        id: 'meteor', name: "Chuva de Meteoros", type: 'AREA',
        castTime: 3000, 
        cooldown: 10000, 
        range: 12.0,     
        radius: 2.5,     
        manaCost: 25,
        damage: 80,      
        animation: 'ATTACK', 
        icon: 'skill_meteor.png',
        description: "Porque jogar pedrinhas é pouco, invoque uma chuva de fogo celestial que atinge tudo e todos dentro da área impactada.",
        soundCast: 'cast_area',   // Som da invocação (area_skill.mp3)
        soundHit: 'hit_magic'     // Som das explosões (impact_hit2.mp3)        
    }    
};



// --- BANCO DE DADOS DE ITENS ---
const ITEM_DATABASE = {
    // --- CONSUMÍVEIS ---
    1: { 
        id: 1, name: "Poção Vital", type: ITEM_TYPES.CONSUMABLE, 
        icon: "pot_hp_s.png", 
        description: "Um gole desse líquido duvidoso e pronto! 50 HP voltam como se nada tivesse acontecido.",
        effect: { hp: 50 },
        cooldown: 1000
    },
    2: { 
        id: 2, name: "Poção Arcana", type: ITEM_TYPES.CONSUMABLE, 
        icon: "pot_mp_s.png", 
        description: "Recupere 30 MP e finja que sua barra nunca ficou zerada. Feiticeiros aprovam, magos viciam.",
        effect: { mp: 30 },
        cooldown: 3000
    },

    // --- EQUIPAMENTOS ---
    100: { 
        id: 100, name: "Espada de Madeira", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        weaponType: WEAPON_TYPES.MELEE, range: 1.0,
        icon: "sword_wood.png", 
        description: "Perfeita para aventureiros iniciantes, para cortar mato… e só. Pelo menos não dá farpa.",
        stats: { atk: 5 } 
    },
    101: { 
        id: 101, name: "Espada de Ferro", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        weaponType: WEAPON_TYPES.MELEE, range: 1.3,
        icon: "sword_iron.png", 
        description: "Forjada com o mais puro ferro… ou o mais barato, ninguém sabe. Afiada o suficiente para convencer.",
        stats: { atk: 15, str: 2 } 
    },

    // --- NOVO ITEM: ARCO ---
    102: { 
        id: 102, name: "Arco Curto", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        weaponType: WEAPON_TYPES.RANGED, range: 5.0,
        icon: "bow_oak.png", 
        description: "Perfeito para quem gosta de atacar à distância e fugir logo em seguida. Elegante e covarde.",
        stats: { atk: 8, agi: 2 } 
    },

    200: {
        id: 200, name: "Túnica de Linho", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.ARMOR,
        icon: "armor_cloth.png", 
        description: "A clássica proteção 'melhor que nada'. Confortável, leve e… é, só isso mesmo.",
        stats: { def: 3, hp: 20 } 
    },

    // --- ARMAS MÁGICAS ---
    105: { 
        id: 105, name: "Cajado de Aprendiz", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.WEAPON,
        weaponType: WEAPON_TYPES.RANGED, range: 4.5,
        icon: "staff_wood.png",
        description: "Canaliza magia básica com eficiência... e serve como apoio quando o cansaço bate.",
        stats: { atk: 5, matk: 15 }
    },

    // --- BOTAS (LEGS) ---
    201: {
        id: 201, name: "Botas de Couro", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.LEGS,
        icon: "boots_leather.png",
        description: "Leves, confortáveis e perfeitas para correr de problemas. Aumentam sua agilidade no processo.",
        stats: { def: 2, agi: 3 }
    },

    // --- ACESSÓRIOS ---
    202: {
        id: 202, name: "Anel de Safira", type: ITEM_TYPES.EQUIPMENT, slot: EQUIP_SLOTS.ACCESSORY,
        icon: "ring_sapphire.png",
        description: "Um elegante anel encantado que amplia seu poder mágico — e seu senso de importância.",
        stats: { int: 2, matk: 8 }
    },
    
    // --- MATERIAIS ---
    300: { 
        id: 300, name: "Gosma Verde", type: ITEM_TYPES.MATERIAL, 
        icon: "slime_goo.png", 
        description: "A essência pegajosa de um Slime. Cheira mal, gruda em tudo, e por algum motivo vale dinheiro.",
        price: 5 
    }

};


const MAP_CONFIG = {
    'vilarejo': {
        id: 'vilarejo', asset: 'mapa1.glb', pvp: false, mapSize: 30,
        offset: { x: 0.5, y: 0, z: 0.5 },
        portals: [{ x: -2.10, z: 13.45, radius: 1.0, targetMap: 'floresta', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
            { type: 'bolota', count: 2, area: { x: 0, z: 0, radius: 8 } },
            { type: 'morcego', count: 2, area: { x: 0, z: 0, radius: 8 } },
            { type: 'verdinho', count: 2, area: { x: 0, z: 0, radius: 8 } },
            { type: 'cogumelo', count: 2, area: { x: -5, z: 5, radius: 6 } },
            { type: 'cogumelochefe', count: 1, area: { x: -5, z: 5, radius: 6 } }            
        ] 
    },
    'floresta': {
        id: 'floresta', asset: 'mapa2.glb', pvp: true, mapSize: 20,
        offset: { x: 0, y: 0, z: 0 },
        portals: [{ x: 0, z: 8.5, radius: 1.0, targetMap: 'vilarejo', targetX: 0, targetZ: 0 }],
        monsterSpawns: [
//            { type: 'verdinho', count: 3, area: { x: 0, z: 0, radius: 8 } },
//            { type: 'cogumelo', count: 3, area: { x: -5, z: 5, radius: 6 } },
//            { type: 'cogumelochefe', count: 1, area: { x: -5, z: 5, radius: 6 } }
        ]
    }
};

const BEHAVIOR = { NEUTRAL: 0, AGGRESSIVE: 1 };

const MONSTER_TYPES = {
    'bolota': { 
        name: 'Bolota Cascavél', drops: [{ itemId: 300, chance: 40 }, { itemId: 1, chance: 15 }],
        model: 'm1_slimecobra', scale: 0.40, hp: 80, maxHp: 80, speed: 0.06, range: 1.0,
        attackSpeed: 1800, dmg: 8, xp: 15, behavior: BEHAVIOR.NEUTRAL, sightRange: 10.0        
    },
    'morcego': { 
        name: 'Morcego', model: 'm2_morcego', scale: 0.30, hp: 130, maxHp: 130, speed: 0.12, range: 1.0,
        attackSpeed: 1500, dmg: 14, xp: 30, behavior: BEHAVIOR.AGGRESSIVE, sightRange: 8.0          
    },
    'verdinho': { 
        name: 'Verdinho', model: 'm3_slimeverde', scale: 0.05, hp: 300, maxHp: 300, speed: 0.10, range: 1.0,
        attackSpeed: 1200, dmg: 22, xp: 50, behavior: BEHAVIOR.NEUTRAL, sightRange: 10.0          
    },
    'cogumelo': {
        name: 'Cogulouco', model: 'm4_cogumelo', scale: 0.05, hp: 900, maxHp: 900, speed: 0.10, range: 1.0,
        attackSpeed: 2000, dmg: 35, xp: 120, behavior: BEHAVIOR.NEUTRAL, sightRange: 10.0          
    },
    'cogumelochefe': {
        name: 'Mestre Cogulouco', model: 'm4_cogumelo', scale: 0.07, hp: 2000, maxHp: 1200, speed: 0.10, range: 1.3,
        attackSpeed: 1800, dmg: 60, xp: 300, behavior: BEHAVIOR.AGGRESSIVE, sightRange: 10.0         
    }
};

module.exports = {
    LEVEL_TABLE, BASE_ATTRIBUTES, RESPAWN_POINT, MAP_CONFIG,
    MONSTER_TYPES, ITEM_DATABASE, ITEM_TYPES, EQUIP_SLOTS, WEAPON_TYPES, SKILL_DATABASE
};