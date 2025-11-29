// public/js/AudioManager.js

const context = new (window.AudioContext || window.webkitAudioContext)();
let myPosRef = null; 

// --- NÓS DE VOLUME ---
const masterGain = context.createGain();
const bgmGain = context.createGain();
const sfxGain = context.createGain();

masterGain.connect(context.destination);
bgmGain.connect(masterGain);
sfxGain.connect(masterGain);

masterGain.gain.value = 0.5;
bgmGain.gain.value = 0.4; 
sfxGain.gain.value = 0.7;

const MAX_HEARING_DISTANCE = 20.0; 
const lastPlayTimes = {}; 
const SPAM_THRESHOLD = 80; 
const activeLoops = {}; 

const ASSETS = {
    // UI
    'ui_click': 'assets/sounds/click1.mp3',      
    'ui_stat': 'assets/sounds/click2.mp3',       
    
    // Itens (Caminhos revisados)
    'equip': 'assets/sounds/equip_item.mp3',     // Som de vestir/tirar
    'pickup': 'assets/sounds/gold_gain.mp3',     // Som de pegar do chão
    'potion': 'assets/sounds/support_item.mp3',  

    // Combate
    'conjure': 'assets/sounds/conjure.mp3',      
    'cast_ranged': 'assets/sounds/casting_skill.mp3',
    'cast_area': 'assets/sounds/area_skill.mp3',
    'cast_support': 'assets/sounds/support_skill.mp3',
    
    // Impactos
    'hit_basic': 'assets/sounds/impact_hit.mp3', 
    'hit_magic': 'assets/sounds/impact_hit2.mp3',
    'hit_skill': 'assets/sounds/melee_skill.mp3',
    'enemy_damage': 'assets/sounds/enemy_damage.mp3', 

    // Música (VOLTANDO PARA .WEBM)
    'bgm_login': 'assets/bgm1.webm', 
    'bgm_game': 'assets/bgm2.webm'
};

const buffers = {};
let currentBgmNode = null;
let currentBgmKey = null;

export const AudioManager = {
    init: (playerMesh) => {
        myPosRef = playerMesh ? playerMesh.position : null;
        AudioManager.resumeContext();
        AudioManager.preload();
    },

    resumeContext: () => {
        if (context.state === 'suspended') {
            context.resume();
        }
    },

    preload: () => {
        for (const [key, path] of Object.entries(ASSETS)) {
            fetch(path)
                .then(response => {
                    if (!response.ok) throw new Error(`Status ${response.status}`);
                    return response.arrayBuffer();
                })
                .then(arrayBuffer => context.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    buffers[key] = audioBuffer;
                })
                .catch(e => console.warn(`Erro audio (${key}):`, e));
        }
    },

    updatePositionRef: (pos) => { myPosRef = pos; },

    playBGM: (key) => {
        if (currentBgmKey === key) return; 
        
        // Se ainda não carregou, tenta de novo em breve
        if (!buffers[key]) {
            setTimeout(() => AudioManager.playBGM(key), 500);
            return;
        }

        if (currentBgmNode) {
            const oldNode = currentBgmNode;
            oldNode.gainNode.gain.setTargetAtTime(0, context.currentTime, 0.5);
            oldNode.stop(context.currentTime + 0.5);
        }

        const source = context.createBufferSource();
        source.buffer = buffers[key];
        source.loop = true;

        const gainNode = context.createGain();
        gainNode.gain.value = 1.0; 

        source.connect(gainNode);
        gainNode.connect(bgmGain); 
        
        source.start(0);
        currentBgmNode = source;
        currentBgmNode.gainNode = gainNode;
        currentBgmKey = key;
    },

    play2D: (key) => {
        if (!buffers[key]) return;
        playBuffer(buffers[key], 1.0, sfxGain);
    },

    play3D: (key, position) => {
        if (!buffers[key] || !myPosRef) return; 
        const now = Date.now();
        if (lastPlayTimes[key] && (now - lastPlayTimes[key] < SPAM_THRESHOLD)) return;
        lastPlayTimes[key] = now;

        const dist = myPosRef.distanceTo(position);
        if (dist > MAX_HEARING_DISTANCE) return;

        let vol = 1.0 - (dist / MAX_HEARING_DISTANCE);
        vol = Math.max(0, vol * vol); 

        playBuffer(buffers[key], vol, sfxGain);
    },

    playLoop: (key) => {
        if (activeLoops[key]) return; 
        if (!buffers[key]) return;

        const source = context.createBufferSource();
        source.buffer = buffers[key];
        source.loop = true;

        const gainNode = context.createGain();
        gainNode.gain.value = 1.0;

        source.connect(gainNode);
        gainNode.connect(sfxGain);
        
        source.start(0);
        activeLoops[key] = { source, gainNode };
    },

    stopLoop: (key) => {
        const loopObj = activeLoops[key];
        if (loopObj) {
            loopObj.gainNode.gain.setTargetAtTime(0, context.currentTime, 0.1);
            loopObj.source.stop(context.currentTime + 0.1);
            delete activeLoops[key];
        }
    }
};

function playBuffer(buffer, volume, destinationNode) {
    if (context.state === 'suspended') context.resume();
    
    const source = context.createBufferSource();
    source.buffer = buffer;
    
    const gainNode = context.createGain();
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(destinationNode);
    
    source.start(0);
}