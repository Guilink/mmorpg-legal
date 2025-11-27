// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

// Esta função permite que o game.js force o estado do chat
export function setChatActive(state) {
    isChatActive = state;
}

// O erro no console dizia que esta função não existia/não estava exportada
export function getIsChatActive() {
    return isChatActive;
}

// A função principal com as novas regras de ataque
export function setupInputs(onEnterPress, onSit, onAttack) { 
    document.addEventListener('keydown', e => {
        // Bloqueia repetição automática de tecla segurada
        if (e.repeat) return; 

        // 1. Lógica do Chat
        if (isChatActive) {
            // Se apertar Enter no chat, envia
            if (e.key === 'Enter') {
                if(onEnterPress) onEnterPress();
            }
            return; // Não faz mais nada se chat estiver aberto
        }

        // 2. Abrir Chat
        if(e.key === 'Enter') {
            if(onEnterPress) onEnterPress();
            return; 
        }
        
        // 3. Registra tecla segurada para movimento e loop de ataque
        keys[e.key.toLowerCase()] = true;

        // 4. Tecla Space (Sentar)
        if(e.code === 'Space') {
            if(onSit) onSit(); 
        }

        // 5. Tecla F (Ataque - Evento Único)
        // Garante o primeiro golpe instantâneo ao apertar
        if(e.key.toLowerCase() === 'f') {
            if(onAttack) onAttack();
        }
    });

    document.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;        
    });

    // Se o jogador clicar fora da tela ou der Alt-Tab, cancela todas as teclas
    window.addEventListener('blur', () => {
        for (let k in keys) keys[k] = false;
    });
}