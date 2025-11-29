// public/js/AudioManager.js

const sounds = {};
const context = new (window.AudioContext || window.webkitAudioContext)();
let myPosRef = null; // Referência da posição do jogador

// Configuração de Volume Global
const MASTER_VOLUME = 0.5;
const MAX_HEARING_DISTANCE = 25.0; // Metros até parar de ouvir

// Mapeamento de Arquivos
const ASSETS = {
    // UI / Locais
    'ui_click': 'assets/sounds/click1.mp3',
    'ui_stat': 'assets/sounds/click2.mp3',
    'equip': 'assets/sounds/equip_item.mp3',
    'potion': 'assets/sounds/support_item.mp3',
    'levelup': 'assets/sounds/levelup.mp3',
    'gold': 'assets/sounds/gold_gain.mp3',

    // Habilidades (Lançamento)
    'cast_ranged': 'assets/sounds/casting_skill.mp3',
    'cast_area': 'assets/sounds/area_skill.mp3',
    'cast_support': 'assets/sounds/support_skill.mp3',
    
    // Impactos (Dano)
    'hit_basic': 'assets/sounds/impact_hit.mp3',   // Soco/Espada normal
    'hit_magic': 'assets/sounds/impact_hit2.mp3',  // Bola de fogo/Magia batendo
    'hit_skill': 'assets/sounds/melee_skill.mp3'   // Skill física (Golpe Feroz) batendo
};

export const AudioManager = {
    init: (playerMesh) => {
        myPosRef = playerMesh.position;
        // Tenta desbloquear o áudio do navegador
        if (context.state === 'suspended') {
            const resume = () => context.resume();
            window.addEventListener('click', resume, { once: true });
            window.addEventListener('keydown', resume, { once: true });
        }
        AudioManager.preload();
    },

    preload: () => {
        for (const [key, path] of Object.entries(ASSETS)) {
            fetch(path)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => context.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    sounds[key] = audioBuffer;
                })
                .catch(e => console.warn(`Erro ao carregar som: ${path}`, e));
        }
    },

    // Toca um som 2D (sem posição, volume cheio) - Para UI e Self
    play2D: (key) => {
        if (!sounds[key]) return;
        playBuffer(sounds[key], 1.0);
    },

    // Toca um som 3D (baseado na posição de origem) - Para Skills e Hits
    play3D: (key, position) => {
        if (!sounds[key] || !myPosRef) return;

        // Cálculo de Distância (Simples e Leve)
        const dist = myPosRef.distanceTo(position);
        
        if (dist > MAX_HEARING_DISTANCE) return; // Muito longe, nem toca

        // Atenuação linear (1.0 no pé, 0.0 no limite)
        let vol = 1.0 - (dist / MAX_HEARING_DISTANCE);
        vol = Math.max(0, vol); 

        playBuffer(sounds[key], vol);
    }
};

// Função interna para tocar o buffer
function playBuffer(buffer, volume) {
    if (context.state === 'suspended') context.resume();
    
    const source = context.createBufferSource();
    source.buffer = buffer;
    
    const gainNode = context.createGain();
    gainNode.gain.value = volume * MASTER_VOLUME;
    
    source.connect(gainNode);
    gainNode.connect(context.destination);
    
    source.start(0);
}