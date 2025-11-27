// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

// Esta função permite que o game.js force o estado do chat
export function setChatActive(state) {
    isChatActive = state;
}

export function getIsChatActive() {
    return isChatActive;
}

export function setupInputs(onEnterPress, onSit) { 
    document.addEventListener('keydown', e => {
        if (e.repeat) return; 

        // 1. SE O CHAT ESTIVER ATIVO
        if (isChatActive) {
            // Se apertar Enter, apenas avisa o game.js. 
            // NÃO altera 'isChatActive = false' aqui. Deixa o game.js decidir.
            if (e.key === 'Enter') {
                if(onEnterPress) onEnterPress();
            }
            // Bloqueia qualquer outra tecla (WASD) de ser registrada
            return;
        }

        // 2. SE O CHAT ESTIVER FECHADO
        if(e.key === 'Enter') {
            // Avisa o game.js para abrir
            if(onEnterPress) onEnterPress();
            return; // Não registra o enter como tecla de jogo
        }
        
        // Registra teclas de movimento apenas se chat estiver fechado
        keys[e.key.toLowerCase()] = true;

        // Space para Sentar
        if(e.code === 'Space') {
            if(onSit) onSit(); 
        }
    });

    document.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;
    });
}