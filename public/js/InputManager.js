// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

export function setupInputs(onChatToggle, onSit) { 
    // ^ Removemos onAttack dos argumentos, pois trataremos no loop principal

document.addEventListener('keydown', e => {
        // CORREÇÃO 1: Impede que segurar a tecla fique disparando o evento loucamente
        if (e.repeat) return; 

        // Se o chat estiver aberto...
        if (isChatActive) {
            if (e.key === 'Enter') {
                isChatActive = false;
                if(onChatToggle) onChatToggle(isChatActive);
            }
            return;
        }

        // Lógica do Chat (Abrir)
        if(e.key === 'Enter') {
            isChatActive = true;
            // Reseta teclas de movimento para o boneco não sair andando sozinho
            keys['w'] = keys['a'] = keys['s'] = keys['d'] = keys['f'] = false; 
            if(onChatToggle) onChatToggle(isChatActive);
            return;
        }
        
        // Registra tecla pressionada
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

export function getIsChatActive() {
    return isChatActive;
}